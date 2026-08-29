"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getCurrentUser } from "../../../lib/api-client";
import { useRealtimeEvent, useRealtimeRefetch } from "../../../lib/realtime";
import { AGENT_LABELS } from "../../../lib/agent-labels";
import { ALLOWED_TRANSITIONS, PIPELINE_STAGE_ORDER, PipelineStage, isValidRewind } from "@leadgen/types";
import type { Lead, LeadScore } from "@leadgen/types";
import { LoadingRow, Spinner } from "../../../components/spinner";

interface AgentRunSummary {
  agent: string;
  status: string;
  startedAt: string;
}

interface EmailSummary {
  subject: string;
  status: string;
  sequenceStep: number;
  sentAt: string | null;
  events?: { occurredAt: string }[];
}

interface LeadRow extends Lead {
  score: LeadScore | null;
  pipelineState: { stage: string; previousStage: string | null; enteredStageAt: string } | null;
  agentRuns?: AgentRunSummary[];
  emailMessages?: EmailSummary[];
}

/** Which method actually found this lead. No "dark web" value exists —
 *  see LeadSourceLayer's doc comment in @leadgen/types for why. */
const SOURCE_LABELS: Record<string, { label: string; className: string }> = {
  SURFACE_WEB: { label: "Web", className: "bg-ink/8 text-ink/50" },
  LICENSED_DATABASE: { label: "Licensed DB", className: "bg-accent/15 text-accent" },
  MANUAL: { label: "Manual", className: "bg-ink/8 text-ink/50" },
};

function SourceBadge({ source }: { source?: string }) {
  const info = source ? SOURCE_LABELS[source] : null;
  if (!info) return null;
  return (
    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${info.className}`}>
      {info.label}
    </span>
  );
}

function agentTone(status: string) {
  if (status === "OK") return "text-good";
  if (status === "DEGRADED") return "text-gold";
  if (status === "SKIPPED") return "text-ink/45";
  return "text-bad";
}

function timeAgo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** The email_only pipeline (review -> email -> scheduler) that drafts each
 *  step of the 5-email sequence. */
const EMAIL_PIPELINE_AGENTS = new Set(["review", "email", "scheduler"]);

/** Stages where an AI draft could plausibly be in flight in the background —
 *  every waiting stage of the 5-email sequence, plus READY_FOR_OUTREACH
 *  itself (Email 1 drafts the instant that stage is entered). */
const DRAFTING_POSSIBLE_STAGES = new Set([
  "READY_FOR_OUTREACH", "WAITING_EMAIL_2", "WAITING_EMAIL_3", "WAITING_EMAIL_4", "WAITING_EMAIL_5",
]);

interface RunningAgent {
  agent: string;
  responsibility?: string;
}

/**
 * What's actually happening on this card right now. `running`, if given, is a
 * live "agentRun.started" signal for this specific lead — the accurate,
 * general answer to "which agent is working and what is it doing" across
 * every stage.
 *
 * The drafting-possible stages keep one extra fallback below: a lead can sit
 * there for minutes with no live signal ever having arrived (a lead advanced
 * into the stage without the pipeline actually being triggered — a real bug
 * hit once, see SequencerService.onStageEntered) — that case flags as "Not
 * started" rather than showing nothing.
 */
function AgentActivity({ lead, running }: { lead: LeadRow; running?: RunningAgent }) {
  const stage = lead.pipelineState?.stage;
  const last = lead.agentRuns?.[0];

  if (running) {
    return (
      <div
        className="mt-1.5 flex items-center gap-1.5 text-[11px] text-accent"
        title={running.responsibility}
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        <span className="truncate">{AGENT_LABELS[running.agent] ?? running.agent} working…</span>
      </div>
    );
  }

  if (stage && DRAFTING_POSSIBLE_STAGES.has(stage)) {
    const enteredAt = lead.pipelineState?.enteredStageAt ? new Date(lead.pipelineState.enteredStageAt).getTime() : null;
    const minutesInStage = enteredAt ? Math.floor((Date.now() - enteredAt) / 60000) : 0;
    const relevant =
      last && enteredAt && EMAIL_PIPELINE_AGENTS.has(last.agent) && new Date(last.startedAt).getTime() >= enteredAt
        ? last
        : null;

    if (!relevant && minutesInStage >= 2) {
      return (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-gold" title="Open the lead and use &quot;Generate pitch draft&quot; to retry.">
          <span className="h-1.5 w-1.5 rounded-full bg-gold" />
          Not started · {minutesInStage}m
        </div>
      );
    }
    if (!relevant) {
      return (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-accent">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          Starting…
        </div>
      );
    }
  }

  if (!last) return null;
  return (
    <div className="mt-1.5 flex items-center gap-1 text-[11px] text-ink/50">
      <span className={agentTone(last.status)}>●</span>
      <span className="truncate">{AGENT_LABELS[last.agent] ?? last.agent}</span>
      <span className="text-ink/35">· {timeAgo(last.startedAt)}</span>
    </div>
  );
}

function LastEmail({ lead }: { lead: LeadRow }) {
  const email = lead.emailMessages?.[0];
  if (!email) return null;
  const tone =
    email.status === "SENT" ? "text-good" : email.status === "FAILED" ? "text-bad" : "text-ink/50";
  const when =
    email.status === "SENT"
      ? timeAgo(email.sentAt)
      : email.status === "FAILED"
        ? "failed"
        : "queued";
  const opened = email.events?.[0]?.occurredAt;
  return (
    <div className="mt-1 flex items-center gap-1 text-[11px] text-ink/50" title={email.subject}>
      <span aria-hidden>✉</span>
      <span className="truncate">Email {email.sequenceStep}</span>
      <span className={tone}>· {when}</span>
      {opened && <span className="text-accent" title={`Opened ${new Date(opened).toLocaleString()}`}>· opened {timeAgo(opened)}</span>}
    </div>
  );
}

const LABELS: Record<string, string> = {
  NEW_LEAD: "New Lead",
  VERIFIED: "Verified",
  RESEARCH_COMPLETED: "Research Done",
  UNDER_REVIEW: "Under Review",
  READY_FOR_OUTREACH: "Ready",
  EMAIL_1_SENT: "Email 1: Trigger",
  WAITING_EMAIL_2: "Waiting (E2)",
  EMAIL_2_SENT: "Email 2: Insight",
  WAITING_EMAIL_3: "Waiting (E3)",
  EMAIL_3_SENT: "Email 3: Proof",
  WAITING_EMAIL_4: "Waiting (E4)",
  EMAIL_4_SENT: "Email 4: Offer",
  WAITING_EMAIL_5: "Waiting (E5)",
  EMAIL_5_SENT: "Email 5: Breakup",
  LINKEDIN_OUTREACH: "LinkedIn",
  LINKEDIN_FOLLOW_UP: "LinkedIn F/U",
  REPLIED: "Replied",
  MEETING_BOOKED: "Meeting",
  PROPOSAL_SENT: "Proposal",
  NEGOTIATION: "Negotiation",
  WON: "Won",
  CLIENT_ONBOARDING: "Onboarding",
  LOST: "Lost",
};

const COLUMNS = Object.values(PipelineStage);
const EMPTY_LEADS: LeadRow[] = [];

/** Whether a card may be dropped here, mirroring the API's state machine.
 *  Checked client-side purely to show the affordance — the API re-validates,
 *  and it remains the authority. */
function canDrop(from: string | null, to: string): boolean {
  if (!from || from === to) return false;
  if (to === PipelineStage.LOST) {
    return from !== PipelineStage.WON && from !== PipelineStage.CLIENT_ONBOARDING;
  }
  return (ALLOWED_TRANSITIONS[from as PipelineStage] ?? []).includes(to as PipelineStage);
}

function scoreTone(score?: number | null) {
  if (score == null) return "text-ink/40";
  if (score >= 75) return "text-good";
  if (score >= 50) return "text-gold";
  return "text-ink/50";
}

export default function PipelinePage() {
  const queryClient = useQueryClient();
  const isAdmin = getCurrentUser()?.role === "ADMIN";
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<LeadRow | null>(null);
  const [hoverStage, setHoverStage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteStage, setDeleteStage] = useState("");
  const [deletingStage, setDeletingStage] = useState(false);
  // Live "which agent is working on which lead right now" — keyed by leadId,
  // separate from `leads` because it must update the instant an
  // agentRun.started event lands, not on the 400ms-debounced full refetch
  // below (agentRun.recorded's status/notes still come from that refetch).
  const [runningAgents, setRunningAgents] = useState<Record<string, RunningAgent & { at: number }>>({});

  // Same query key as /leads — both pages call the identical endpoint with
  // identical params, so they share one cache entry: switching between them
  // shows the other's already-loaded data instantly.
  const leadsQuery = useQuery({
    queryKey: ["leads"],
    queryFn: async () => {
      const res: any = await api.getLeads({ pageSize: "200" });
      return (res.items ?? res) as LeadRow[];
    },
  });
  // Stable empty-array identity when data is undefined -- `?? []` would mint
  // a new array every render and defeat the useMemo below it.
  const leads = leadsQuery.data ?? EMPTY_LEADS;

  function invalidateLeads() {
    queryClient.invalidateQueries({ queryKey: ["leads"] });
  }

  // No page in this app should ever need a manual reload to see current
  // state (Part: autonomous system) — this board previously fetched once on
  // mount and never again, so a card another user (or the pipeline itself)
  // moved stayed frozen in its old column until someone happened to refresh.
  useRealtimeRefetch(
    ["lead.created", "lead.stageChanged", "lead.updated", "agentRun.recorded", "agentDispatch.status"],
    invalidateLeads,
  );

  // Prunes entries older than 5 minutes — a safety net for the rare case an
  // agent's "started" is never followed by a "recorded" (worker crash
  // mid-run), so a card can't show "working…" forever.
  const pruneStale = (map: Record<string, RunningAgent & { at: number }>) => {
    const cutoff = Date.now() - 5 * 60 * 1000;
    const next: Record<string, RunningAgent & { at: number }> = {};
    for (const [id, v] of Object.entries(map)) if (v.at >= cutoff) next[id] = v;
    return next;
  };
  useRealtimeEvent<{ leadId: string; agent: string; responsibility?: string }>("agentRun.started", (payload) => {
    setRunningAgents((cur) => ({
      ...pruneStale(cur),
      [payload.leadId]: { agent: payload.agent, responsibility: payload.responsibility, at: Date.now() },
    }));
  });
  useRealtimeEvent<{ leadId: string; agent: string }>("agentRun.recorded", (payload) => {
    setRunningAgents((cur) => {
      if (cur[payload.leadId]?.agent !== payload.agent) return cur;
      const next = { ...cur };
      delete next[payload.leadId];
      return next;
    });
  });
  useRealtimeEvent<{ leadId: string; status: string }>("agentDispatch.status", (payload) => {
    if (payload.status !== "FAILED") return;
    setRunningAgents((cur) => {
      if (!(payload.leadId in cur)) return cur;
      const next = { ...cur };
      delete next[payload.leadId];
      return next;
    });
  });

  const byStage = useMemo(() => {
    const grouped = new Map<string, LeadRow[]>();
    for (const lead of leads) {
      const stage = lead.pipelineState?.stage ?? "NEW_LEAD";
      if (!grouped.has(stage)) grouped.set(stage, []);
      grouped.get(stage)!.push(lead);
    }
    return grouped;
  }, [leads]);

  async function moveTo(lead: LeadRow, stage: string) {
    const from = lead.pipelineState?.stage ?? null;
    if (!canDrop(from, stage)) return;

    setBusy(lead.id);
    setError(null);

    // Optimistic: the card moves immediately so dragging feels direct. Reverted
    // below if the API rejects it, which it can — the server re-validates the
    // transition and is the authority.
    const previous = queryClient.getQueryData<LeadRow[]>(["leads"]);
    queryClient.setQueryData<LeadRow[]>(["leads"], (rows) =>
      (rows ?? []).map((r) =>
        r.id === lead.id
          ? { ...r, pipelineState: { stage, previousStage: from, enteredStageAt: new Date().toISOString() } }
          : r,
      ),
    );

    try {
      await api.advanceStage(lead.id, stage);
      invalidateLeads();
    } catch (err) {
      queryClient.setQueryData(["leads"], previous);
      setError(`Could not move ${lead.companyName}: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  /** Back to any earlier stage the user picks, not only the one immediately
   *  before this one — also how a failed automated send (e.g. no mailbox
   *  configured yet) gets retried: back to Ready, then forward again. */
  async function rewind(lead: LeadRow, toStage: string) {
    setBusy(lead.id);
    setError(null);
    try {
      await api.rewindLead(lead.id, toStage);
      invalidateLeads();
    } catch (err) {
      setError(`Could not move ${lead.companyName} back: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  /** Unlike the niche-filter/email-account deletes elsewhere, there is no
   *  "detach and keep" option — this wipes the lead's full history, including
   *  any real emails already sent to the prospect, so the confirmation says
   *  so explicitly rather than a generic "are you sure?". */
  async function deleteLead(lead: LeadRow, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (
      !window.confirm(
        `Permanently delete ${lead.companyName}?\n\n` +
          "This removes its full history — scores, review notes, and any emails already sent — and cannot be undone.",
      )
    )
      return;

    setBusy(lead.id);
    setError(null);
    try {
      await api.deleteLead(lead.id);
      queryClient.setQueryData<LeadRow[]>(["leads"], (rows) => (rows ?? []).filter((r) => r.id !== lead.id));
    } catch (err) {
      setError(`Could not delete ${lead.companyName}: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  /** Admin-only bulk clear for one entire column — same no-undo, full-
   *  history-wipe semantics as deleteLead above, just scoped to every lead
   *  currently in the picked stage instead of one. The confirm dialog
   *  states the exact count so this can't be clicked past by accident. */
  async function deleteAllInStage() {
    if (!deleteStage) return;
    const count = (byStage.get(deleteStage) ?? []).length;
    if (count === 0) return;
    if (
      !window.confirm(
        `Permanently delete all ${count} lead${count === 1 ? "" : "s"} in "${LABELS[deleteStage] ?? deleteStage}"?\n\n` +
          "This removes their full history — scores, review notes, and any emails already sent — and cannot be undone.",
      )
    )
      return;

    setDeletingStage(true);
    setError(null);
    try {
      await api.deleteLeadsByStage(deleteStage);
      queryClient.setQueryData<LeadRow[]>(["leads"], (rows) =>
        (rows ?? []).filter((r) => (r.pipelineState?.stage ?? "NEW_LEAD") !== deleteStage),
      );
      setDeleteStage("");
    } catch (err) {
      setError(`Could not delete leads in "${LABELS[deleteStage] ?? deleteStage}": ${(err as Error).message}`);
    } finally {
      setDeletingStage(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">Pipeline</h1>
            {leadsQuery.isFetching && !leadsQuery.isLoading && <Spinner className="h-3.5 w-3.5" />}
          </div>
          <p className="mt-0.5 text-xs text-ink/55">
            Drag a card to move it. Only valid next stages accept a drop — the same rules the
            automation follows, so a manual move can&apos;t create a state the sequencer won&apos;t
            understand.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <div className="flex items-center gap-1.5">
              <select
                value={deleteStage}
                onChange={(e) => setDeleteStage(e.target.value)}
                disabled={deletingStage}
                title="Admin: delete every lead currently in this stage"
                className="rounded border border-[var(--line)] bg-transparent px-2 py-1 text-xs text-ink/70 disabled:opacity-50"
              >
                <option value="">Delete stage…</option>
                {COLUMNS.map((stage) => {
                  const count = (byStage.get(stage) ?? []).length;
                  return (
                    <option key={stage} value={stage} disabled={count === 0}>
                      {LABELS[stage] ?? stage} ({count})
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                disabled={!deleteStage || deletingStage}
                onClick={deleteAllInStage}
                className="rounded border border-[rgb(var(--bad-rgb)/0.4)] px-2 py-1 text-xs font-medium text-bad transition-colors hover:bg-[rgb(var(--bad-rgb)/0.08)] disabled:opacity-40"
              >
                {deletingStage ? "Deleting…" : "Delete all"}
              </button>
            </div>
          )}
          <span className="text-xs text-ink/50">{leads.length} leads</span>
        </div>
      </div>

      {(error || leadsQuery.error) && (
        <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
          {error ?? (leadsQuery.error as Error).message}
        </div>
      )}

      {leadsQuery.isLoading ? (
        <LoadingRow label="Loading pipeline…" />
      ) : (
      <div className="flex gap-3 overflow-x-auto pb-3">
        {COLUMNS.map((stage) => {
          const cards = byStage.get(stage) ?? [];
          const from = dragging?.pipelineState?.stage ?? null;
          const droppable = dragging ? canDrop(from, stage) : false;
          const blocked = Boolean(dragging) && !droppable && from !== stage;
          const isHover = hoverStage === stage;

          return (
            <section
              key={stage}
              onDragOver={(e) => {
                // preventDefault is what actually permits a drop; without it the
                // browser refuses regardless of any visual affordance.
                if (droppable) {
                  e.preventDefault();
                  setHoverStage(stage);
                }
              }}
              onDragLeave={() => setHoverStage((s) => (s === stage ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setHoverStage(null);
                if (dragging && droppable) moveTo(dragging, stage);
                setDragging(null);
              }}
              className={`card flex w-64 shrink-0 flex-col transition-colors ${
                isHover && droppable ? "drop-target" : blocked ? "drop-blocked" : ""
              }`}
            >
              <header className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink/65">
                  {LABELS[stage] ?? stage}
                </span>
                <span className="tabular rounded-full bg-ink/8 px-2 py-0.5 text-[11px] text-ink/70">
                  {cards.length}
                </span>
              </header>

              <div className="flex min-h-[80px] flex-col gap-2 p-2">
                {cards.map((lead) => (
                  <article
                    key={lead.id}
                    draggable
                    onDragStart={() => setDragging(lead)}
                    onDragEnd={() => {
                      setDragging(null);
                      setHoverStage(null);
                    }}
                    className={`card card-interactive cursor-grab p-2.5 text-xs active:cursor-grabbing ${
                      dragging?.id === lead.id ? "drag-ghost" : ""
                    } ${busy === lead.id ? "opacity-50" : ""}`}
                  >
                    <Link href={`/leads/${lead.id}`} className="block">
                      <div className="flex items-center gap-1.5">
                        <div className="truncate font-medium leading-snug text-ink">{lead.companyName}</div>
                        <SourceBadge source={lead.sourceLayer} />
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <span className="truncate text-ink/55">{lead.industry ?? "—"}</span>
                        <span className={`tabular font-semibold ${scoreTone(lead.score?.leadScore)}`}>
                          {lead.score?.leadScore ?? "—"}
                        </span>
                      </div>
                      {lead.country && (
                        <div className="mt-1 text-[11px] text-ink/40">{lead.country}</div>
                      )}
                      <AgentActivity lead={lead} running={runningAgents[lead.id]} />
                      <LastEmail lead={lead} />
                    </Link>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      {(() => {
                        const currentStage = (lead.pipelineState?.stage ?? "NEW_LEAD") as PipelineStage;
                        const backOptions = PIPELINE_STAGE_ORDER.filter((s) => isValidRewind(currentStage, s));
                        if (backOptions.length === 0) return null;
                        return (
                          <select
                            key={`${lead.id}-${currentStage}`}
                            defaultValue=""
                            disabled={busy === lead.id}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              if (e.target.value) rewind(lead, e.target.value);
                            }}
                            title="Move this lead back to an earlier stage — a correction, skips the forward automation."
                            className="rounded border border-[var(--line)] bg-transparent px-1.5 py-0.5 text-[10px] text-ink/50 transition-colors hover:bg-ink/5 hover:text-ink/80 disabled:opacity-50"
                          >
                            <option value="" disabled>← Back to…</option>
                            {backOptions.map((s) => (
                              <option key={s} value={s}>{LABELS[s] ?? s}</option>
                            ))}
                          </select>
                        );
                      })()}
                      <button
                        type="button"
                        disabled={busy === lead.id}
                        onClick={(e) => deleteLead(lead, e)}
                        title={`Delete ${lead.companyName}`}
                        className="ml-auto rounded border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-bad transition-colors hover:bg-[rgb(var(--bad-rgb)/0.08)] disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
                {cards.length === 0 && (
                  <p className="px-1 py-4 text-center text-[11px] text-ink/35">
                    {droppable ? "Drop here" : "Empty"}
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
      )}
    </div>
  );
}
