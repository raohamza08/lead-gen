"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getCurrentUser } from "../../../lib/api-client";
import { useRealtimeEvent, useRealtimeRefetch } from "../../../lib/realtime";
import { AGENT_LABELS } from "../../../lib/agent-labels";
import { ALLOWED_TRANSITIONS, PIPELINE_STAGE_ORDER, PipelineStage, isValidRewind } from "@leadgen/types";
import type { Lead, LeadScore } from "@leadgen/types";
import { AgentPulse, LoadingRow, Spinner } from "../../../components/spinner";
import { InitialsAvatar } from "../../../components/avatar";
import { LeadsSidebar, LeadsSidebarFilter } from "../../../components/leads/leads-sidebar";
import { InlineField, SplitPrimaryButton } from "../../../components/open-item-workspace";

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
  // Only a *verified* open (Part: 3-minute open verification, 2026-09-01) —
  // a raw pixel fetch inside the first 3 minutes after sending never counts.
  verifiedOpenedAt: string | null;
  // Display-only countdown target while status is WAITING_FOR_SCHEDULE
  // (Part: Preparation Pipeline / Sending Queue, 2026-09-01) — the backend
  // scheduler, not this timestamp, is what actually decides when the send
  // happens; a refresh just re-fetches the same server value.
  scheduledAt: string | null;
}

/** Persisted retry/lock state for one (lead, agent) pair — survives a
 *  refresh, unlike the live "agentRun.started" ping (see AGENT_LABELS'
 *  runningAgents). Mirrors AgentExecutionStatus in schema.prisma. */
interface AgentExecutionSummary {
  agent: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED_RETRY_SCHEDULED" | "FAILED_TERMINAL";
  attempt: number;
  errorSummary: string | null;
  lastAttemptAt: string;
  nextRetryAt: string | null;
}

interface LeadRow extends Lead {
  score: LeadScore | null;
  pipelineState: {
    stage: string;
    previousStage: string | null;
    enteredStageAt: string;
    nextActionAt: string | null;
    // Part: Preparation Pipeline / Sending Queue, 2026-09-01 — aggregate
    // readiness of the CURRENT sequence step's required agents.
    preparationStatus?: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE" | "FAILED";
    preparationStep?: number | null;
  } | null;
  agentRuns?: AgentRunSummary[];
  emailMessages?: EmailSummary[];
  agentExecutions?: AgentExecutionSummary[];
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

/** Live countdown to a server-provided timestamp — `now` is a ticking value
 *  from the parent (one shared interval, not one per card), same pattern as
 *  the automation page's Send queue. Only ever displays a backend-scheduled
 *  time (PipelineState.nextActionAt / AgentExecution.nextRetryAt); a
 *  refresh just re-fetches that same timestamp, it never resets a client
 *  timer. */
function formatCountdown(targetIso: string, now: number): string {
  const ms = new Date(targetIso).getTime() - now;
  if (ms <= 0) return "Any moment now";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

/** "Next stage in: 47m 23s" — only shown once a wait timer is actually
 *  scheduled (nextActionAt set), i.e. the lead is between automated steps,
 *  not waiting on a human/agent action. */
function StageCountdown({ lead, now }: { lead: LeadRow; now: number }) {
  const nextActionAt = lead.pipelineState?.nextActionAt;
  if (!nextActionAt) return null;
  return (
    <div className="mt-1 text-[11px] text-ink/45">
      Next stage in: <span className="tabular font-medium text-ink/65">{formatCountdown(nextActionAt, now)}</span>
    </div>
  );
}

/** "Status: Failed / Error: ... / Last attempt: .../ Next retry: ..." — the
 *  exact shape the spec asks for. Only rendered for a row the backend has
 *  actually scheduled a retry for (FAILED_RETRY_SCHEDULED); a terminal
 *  failure (precondition absent, not transient) shows the error without a
 *  retry line since none is coming. */
function ErrorBanner({ execution, now }: { execution: AgentExecutionSummary; now: number }) {
  const retrying = execution.status === "FAILED_RETRY_SCHEDULED";
  return (
    <div className="mt-1.5 rounded border border-[rgb(var(--bad-rgb)/0.3)] bg-[rgb(var(--bad-rgb)/0.06)] px-1.5 py-1 text-[10px] leading-tight text-bad">
      <div className="font-semibold uppercase tracking-wide">Status: Failed</div>
      <div className="truncate" title={execution.errorSummary ?? undefined}>Error: {execution.errorSummary ?? "Agent execution failed"}</div>
      <div className="text-bad/80">Last attempt: {timeAgo(execution.lastAttemptAt) ?? "just now"}</div>
      {retrying && execution.nextRetryAt && (
        <div className="text-bad/80">Next retry: {formatCountdown(execution.nextRetryAt, now)}</div>
      )}
    </div>
  );
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
function AgentActivity({ lead, running, now }: { lead: LeadRow; running?: RunningAgent; now: number }) {
  const stage = lead.pipelineState?.stage;
  const last = lead.agentRuns?.[0];

  // Persisted state takes priority over the live ping: a failure survives a
  // refresh (it comes from the AgentExecution row the backend keeps), while
  // `running` is only an in-memory socket ping that's gone the moment the
  // page reloads (Part: reliability overhaul, 2026-08-31).
  const failedExecution = lead.agentExecutions?.find(
    (e) => e.status === "FAILED_RETRY_SCHEDULED" || e.status === "FAILED_TERMINAL",
  );
  if (failedExecution) {
    return <ErrorBanner execution={failedExecution} now={now} />;
  }

  if (running) {
    return (
      <div className="mt-1.5">
        <AgentPulse label={`${AGENT_LABELS[running.agent] ?? running.agent} working…`} title={running.responsibility} />
      </div>
    );
  }

  // No live ping yet (e.g. right after a page load) but the backend's own
  // lock says an agent is still mid-run — same visual as `running` above,
  // just sourced from the persisted row instead of the socket event.
  const runningExecution = lead.agentExecutions?.find((e) => e.status === "RUNNING");
  if (runningExecution) {
    return (
      <div className="mt-1.5">
        <AgentPulse label={`${AGENT_LABELS[runningExecution.agent] ?? runningExecution.agent} working…`} />
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
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-gold" title="Open the lead and use &quot;Retry draft&quot; to retry.">
          <span className="h-1.5 w-1.5 rounded-full bg-gold" />
          Not started · {minutesInStage}m
        </div>
      );
    }
    if (!relevant) {
      return (
        <div className="mt-1.5">
          <AgentPulse label="Starting…" />
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

/** Text (and tone) for every EmailMessageStatus the sending pipeline can
 *  leave a message in (Part: Preparation Pipeline / Sending Queue,
 *  2026-09-01) — WAITING_FOR_SCHEDULE gets a live countdown to the
 *  backend-computed `scheduledAt`, same display-only pattern as
 *  StageCountdown/ErrorBanner above. */
function emailStatusText(email: EmailSummary, now: number): { text: string; tone: string } {
  switch (email.status) {
    case "SENT":
      return { text: timeAgo(email.sentAt) ?? "sent", tone: "text-good" };
    case "FAILED":
      return { text: "failed", tone: "text-bad" };
    case "SENDING":
      return { text: "sending…", tone: "text-accent" };
    case "RETRY_SCHEDULED":
      return { text: "retrying", tone: "text-gold" };
    case "READY_TO_SEND":
      return { text: "ready to send", tone: "text-ink/50" };
    case "WAITING_FOR_SCHEDULE":
      return {
        text: email.scheduledAt ? `sending in ${formatCountdown(email.scheduledAt, now)}` : "scheduled",
        tone: "text-ink/50",
      };
    case "PENDING_APPROVAL":
      return { text: "needs approval", tone: "text-gold" };
    default:
      return { text: "queued", tone: "text-ink/50" };
  }
}

function LastEmail({ lead, now }: { lead: LeadRow; now: number }) {
  const email = lead.emailMessages?.[0];
  if (!email) return null;
  const { text, tone } = emailStatusText(email, now);
  const opened = email.verifiedOpenedAt;
  return (
    <div className="mt-1 flex items-center gap-1 text-[11px] text-ink/50" title={email.subject}>
      <span aria-hidden>✉</span>
      <span className="truncate">Email {email.sequenceStep}</span>
      <span className={tone}>· {text}</span>
      {opened && <span className="text-accent" title={`Opened ${new Date(opened).toLocaleString()}`}>· opened {timeAgo(opened)}</span>}
    </div>
  );
}

const LABELS: Record<string, string> = {
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
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState<LeadRow | null>(null);
  const [hoverStage, setHoverStage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteStage, setDeleteStage] = useState("");
  const [deletingStage, setDeletingStage] = useState(false);
  const [verifyProgress, setVerifyProgress] = useState<{ done: number; total: number } | null>(null);
  // Sidebar view filter (Part: full UI redesign per UI.md, Pipeline mockup)
  // — client-side only, filters which cards land in byStage below; null
  // means "All leads" / no filter.
  const [sidebarFilter, setSidebarFilter] = useState<LeadsSidebarFilter>(null);
  // "+ New lead" inline form (Part: full UI redesign — wires up
  // api.createManualLead + api.promoteLeadsToPipeline, both of which
  // already existed on the backend/client with no UI anywhere calling
  // them until now).
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [newLeadName, setNewLeadName] = useState("");
  const [newLeadWebsite, setNewLeadWebsite] = useState("");
  const [newLeadEmail, setNewLeadEmail] = useState("");
  const [newLeadIndustry, setNewLeadIndustry] = useState("");
  const [newLeadSaving, setNewLeadSaving] = useState(false);
  const [newLeadError, setNewLeadError] = useState<string | null>(null);
  const currentUserId = getCurrentUser()?.sub;

  // Card multi-select + ribbon bulk actions (Part: full UI redesign per
  // UI.md, Pipeline mockup — explicit user follow-up that the first pass
  // left too much of the ribbon non-functional). Real endpoints: Delete
  // (api.bulkDeleteLeads, already existed), Move stage (loops
  // api.advanceStage per lead, same transition rules as a drag-drop),
  // Assign (api.bulkAssignLeads — new endpoint added for this, since
  // `assignedUserId` existed on Lead with no mutation path anywhere in
  // the app until now). "Mark done" maps onto the real WON stage — this
  // app has no separate "done" concept, but WON is the real terminal
  // "this lead is done" state the pipeline already has.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [moveStageOpen, setMoveStageOpen] = useState(false);
  const orgUsersQuery = useQuery({
    queryKey: ["org-users-for-assign"],
    queryFn: () => api.getUsers() as Promise<{ id: string; name: string; email: string }[]>,
    enabled: assignOpen,
  });

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function bulkDeleteSelected() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (
      !window.confirm(
        `Permanently delete ${ids.length} lead${ids.length === 1 ? "" : "s"}?\n\nThis removes their full history — scores, review notes, and any emails already sent — and cannot be undone.`,
      )
    )
      return;
    setBulkBusy(true);
    setError(null);
    try {
      await api.bulkDeleteLeads(ids);
      clearSelection();
      invalidateLeads();
    } catch (err) {
      setError(`Could not delete selected leads: ${(err as Error).message}`);
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkMoveSelected(targetStage: string) {
    const ids = [...selectedIds];
    setMoveStageOpen(false);
    if (ids.length === 0) return;
    setBulkBusy(true);
    setError(null);
    const targets = promotedLeads.filter((l) => ids.includes(l.id));
    const movable = targets.filter((l) => canDrop(l.pipelineState?.stage ?? null, targetStage));
    try {
      await Promise.all(movable.map((l) => api.advanceStage(l.id, targetStage)));
      invalidateLeads();
      clearSelection();
      if (movable.length < targets.length) {
        setNotice(`Moved ${movable.length} of ${targets.length} — the rest aren't eligible for "${LABELS[targetStage] ?? targetStage}" from their current stage.`);
      }
    } catch (err) {
      setError(`Could not move selected leads: ${(err as Error).message}`);
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkAssignSelected(userId: string | null) {
    const ids = [...selectedIds];
    setAssignOpen(false);
    if (ids.length === 0) return;
    setBulkBusy(true);
    setError(null);
    try {
      await api.bulkAssignLeads(ids, userId);
      invalidateLeads();
      clearSelection();
    } catch (err) {
      setError(`Could not assign selected leads: ${(err as Error).message}`);
    } finally {
      setBulkBusy(false);
    }
  }

  function bulkMarkDone() {
    bulkMoveSelected(PipelineStage.WON);
  }

  // How many cards are rendered per column, independent of how many exist —
  // a column used to render its whole list at once, so the page grew taller
  // as leads piled up in one stage. Fixed-height scrollable columns now
  // reveal more in batches as the user scrolls near the bottom of that one
  // column, not the whole page.
  const BATCH_SIZE = 15;
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
  function visibleCountFor(stage: string) {
    return visibleCounts[stage] ?? BATCH_SIZE;
  }
  function handleColumnScroll(stage: string, e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 100) return;
    setVisibleCounts((prev) => {
      const current = prev[stage] ?? BATCH_SIZE;
      const total = byStage.get(stage)?.length ?? 0;
      if (current >= total) return prev;
      return { ...prev, [stage]: current + BATCH_SIZE };
    });
  }
  // Live "which agent is working on which lead right now" — keyed by leadId,
  // separate from `leads` because it must update the instant an
  // agentRun.started event lands, not on the 400ms-debounced full refetch
  // below (agentRun.recorded's status/notes still come from that refetch).
  const [runningAgents, setRunningAgents] = useState<Record<string, RunningAgent & { at: number }>>({});

  // Drives every countdown on the board (StageCountdown, ErrorBanner's "Next
  // retry") — one shared ticking clock, not one setInterval per card, same
  // pattern as the automation page's Send queue. Only ever formats a
  // server-provided timestamp; a refresh re-fetches that timestamp from the
  // API, it never resets a client-side schedule.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // The kanban genuinely needs every lead (each column's count/contents
  // depend on the whole set, not a page of it) — unlike /leads, which
  // switched to real server-side pagination (Part: performance audit,
  // 2026-09-02) and no longer shares this cache key. What changed here:
  // pages are now fetched in PARALLEL after the first tells us the total
  // page count, instead of one-at-a-time — wall-clock time drops from
  // roughly N round trips to about 2 (page 1, then every remaining page
  // concurrently), the same total data either way.
  const leadsQuery = useQuery({
    queryKey: ["pipeline-leads"],
    queryFn: async () => {
      const pageSize = 200;
      const first: any = await api.getLeads({ page: "1", pageSize: String(pageSize) });
      const items: LeadRow[] = [...(first.items ?? first)];
      const total: number = first.total ?? items.length;
      const pageCount = Math.ceil(total / pageSize);
      if (pageCount > 1) {
        const rest = await Promise.all(
          Array.from({ length: pageCount - 1 }, (_, i) => api.getLeads({ page: String(i + 2), pageSize: String(pageSize) })),
        );
        for (const res of rest as any[]) items.push(...(res.items ?? res));
      }
      return items;
    },
  });
  // Stable empty-array identity when data is undefined -- `?? []` would mint
  // a new array every render and defeat the useMemo below it.
  const leads = leadsQuery.data ?? EMPTY_LEADS;

  function invalidateLeads() {
    queryClient.invalidateQueries({ queryKey: ["pipeline-leads"] });
  }

  // No page in this app should ever need a manual reload to see current
  // state (Part: autonomous system) — this board previously fetched once on
  // mount and never again, so a card another user (or the pipeline itself)
  // moved stayed frozen in its old column until someone happened to refresh.
  useRealtimeRefetch(
    [
      "lead.created",
      "lead.stageChanged",
      "lead.updated",
      "agentRun.recorded",
      "agentDispatch.status",
      // Carries the fresh errorSummary/nextRetryAt/status onto the card the
      // moment a retry is scheduled or resolved (Part: reliability
      // overhaul, 2026-08-31) — same debounced-refetch plumbing as every
      // other live event here, no separate socket state needed since the
      // countdown itself just formats whatever nextRetryAt comes back.
      "agentExecution.updated",
      // Part: Preparation Pipeline / Sending Queue, 2026-09-01 — the same
      // debounced-refetch plumbing picks up every state this new pipeline
      // introduces (preparation progress, queue/schedule status, and the
      // eventual send outcome) without a separate live-state map.
      "preparation.updated",
      "sendingQueue.updated",
      "sendingSession.updated",
    ],
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
  // Drives the "Verify emails" button's progress bar directly — each lead's
  // own badge updates separately via the existing lead.updated-triggered
  // refetch above; this is just the batch-level counter (Part: reliability
  // overhaul, 2026-08-31 — verification itself is now a fire-and-forget
  // bulk call, not a client-side await loop, so this is the only way left
  // to know how far the backend has gotten).
  useRealtimeEvent<{ done: number; total: number }>("leads.verifyEmailsProgress", (payload) => {
    setVerifyProgress((p) => (p ? payload : p));
  });
  // Briefly shows "100%" before the button resets to normal, instead of it
  // vanishing the instant the last lead resolves.
  useEffect(() => {
    if (!verifyProgress || verifyProgress.done < verifyProgress.total) return;
    const id = setTimeout(() => setVerifyProgress(null), 1500);
    return () => clearTimeout(id);
  }, [verifyProgress]);

  // Leads with no pipelineState haven't been promoted out of Lead Room yet
  // (Part: Lead Room / Move to Pipeline) — this board only ever shows what's
  // actually in the pipeline, not the full org-wide lead list the /leads
  // endpoint returns.
  const promotedLeads = useMemo(() => leads.filter((l) => l.pipelineState), [leads]);

  const byStage = useMemo(() => {
    const grouped = new Map<string, LeadRow[]>();
    for (const lead of promotedLeads) {
      const stage = lead.pipelineState!.stage;
      if (!grouped.has(stage)) grouped.set(stage, []);
      grouped.get(stage)!.push(lead);
    }
    return grouped;
  }, [promotedLeads]);

  // Sidebar counts (Part: full UI redesign per UI.md) — always computed
  // against the REAL unfiltered set, so a count never changes just because
  // a different filter happens to be active.
  const sidebarCounts = useMemo(() => {
    const now = Date.now();
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const recentCutoff = now - 48 * 3600 * 1000;
    let my = 0, hot = 0, today = 0, unassigned = 0, recent = 0;
    for (const l of promotedLeads) {
      if (currentUserId && l.assignedUserId === currentUserId) my++;
      if ((l.score?.leadScore ?? 0) >= 75) hot++;
      const activityAt = l.lastActivityAt ? new Date(l.lastActivityAt).getTime() : null;
      if (activityAt && activityAt >= todayStart) today++;
      if (!l.assignedUserId) unassigned++;
      if (new Date(l.createdAt).getTime() >= recentCutoff) recent++;
    }
    return { my, all: promotedLeads.length, hot, today, unassigned, recent };
  }, [promotedLeads, currentUserId]);

  // Which leads the board actually renders — unfiltered unless a sidebar
  // view is active. byStage above stays unfiltered throughout (it backs
  // the admin "Delete stage…" control, which must always target the REAL
  // full stage, not a narrowed view).
  const filteredLeads = useMemo(() => {
    if (!sidebarFilter) return promotedLeads;
    const now = Date.now();
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const recentCutoff = now - 48 * 3600 * 1000;
    return promotedLeads.filter((l) => {
      if (sidebarFilter === "my") return currentUserId && l.assignedUserId === currentUserId;
      if (sidebarFilter === "hot") return (l.score?.leadScore ?? 0) >= 75;
      if (sidebarFilter === "today") {
        const activityAt = l.lastActivityAt ? new Date(l.lastActivityAt).getTime() : null;
        return Boolean(activityAt && activityAt >= todayStart);
      }
      if (sidebarFilter === "unassigned") return !l.assignedUserId;
      if (sidebarFilter === "recent") return new Date(l.createdAt).getTime() >= recentCutoff;
      return true;
    });
  }, [promotedLeads, sidebarFilter, currentUserId]);

  const filteredByStage = useMemo(() => {
    const grouped = new Map<string, LeadRow[]>();
    for (const lead of filteredLeads) {
      const stage = lead.pipelineState!.stage;
      if (!grouped.has(stage)) grouped.set(stage, []);
      grouped.get(stage)!.push(lead);
    }
    return grouped;
  }, [filteredLeads]);

  async function moveTo(lead: LeadRow, stage: string) {
    const from = lead.pipelineState?.stage ?? null;
    if (!canDrop(from, stage)) return;

    setBusy(lead.id);
    setError(null);

    // Optimistic: the card moves immediately so dragging feels direct. Reverted
    // below if the API rejects it, which it can — the server re-validates the
    // transition and is the authority.
    const previous = queryClient.getQueryData<LeadRow[]>(["pipeline-leads"]);
    queryClient.setQueryData<LeadRow[]>(["pipeline-leads"], (rows) =>
      (rows ?? []).map((r) =>
        r.id === lead.id
          ? { ...r, pipelineState: { stage, previousStage: from, enteredStageAt: new Date().toISOString(), nextActionAt: null } }
          : r,
      ),
    );

    try {
      await api.advanceStage(lead.id, stage);
      invalidateLeads();
    } catch (err) {
      queryClient.setQueryData(["pipeline-leads"], previous);
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
      queryClient.setQueryData<LeadRow[]>(["pipeline-leads"], (rows) => (rows ?? []).filter((r) => r.id !== lead.id));
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
      queryClient.setQueryData<LeadRow[]>(["pipeline-leads"], (rows) =>
        (rows ?? []).filter((r) => (r.pipelineState?.stage ?? "READY_FOR_OUTREACH") !== deleteStage),
      );
      setDeleteStage("");
    } catch (err) {
      setError(`Could not delete leads in "${LABELS[deleteStage] ?? deleteStage}": ${(err as Error).message}`);
    } finally {
      setDeletingStage(false);
    }
  }

  /**
   * Bulk "Verify emails" for the Ready column — every lead lands here on
   * creation/promotion now, verified or not (Part: pipeline simplification,
   * 2026-08-29), and this is the only thing that gets an unverified one
   * (human-added, CSV-imported, Email Hub) from sitting there to actually
   * drafting Email 1.
   *
   * Fire-and-forget (Part: reliability overhaul, 2026-08-31) — this used to
   * be a client-side loop awaiting one HTTP call at a time, so the whole
   * batch's wall-clock time was every lead's NeverBounce round trip added
   * together and the button stayed disabled the entire time. The backend
   * now runs the batch itself with bounded concurrency
   * (LeadsService.verifyEmails) and reports progress
   * (leads.verifyEmailsProgress) plus each lead's own result (lead.updated)
   * over realtime — this call just kicks it off and returns immediately.
   */
  async function verifyAllInReady() {
    const targets = (byStage.get(PipelineStage.READY_FOR_OUTREACH) ?? []).filter(
      (l) => !l.verifiedEmail && l.email,
    );
    if (targets.length === 0) return;

    setError(null);
    setNotice(null);
    setVerifyProgress({ done: 0, total: targets.length });

    try {
      await api.verifyEmails(targets.map((l) => l.id));
      setNotice(`Verifying ${targets.length} email${targets.length === 1 ? "" : "s"}… results will update live.`);
    } catch (err) {
      setError(`Could not start verification: ${(err as Error).message}`);
      setVerifyProgress(null);
    }
  }

  /** "+ New lead" (Part: full UI redesign per UI.md, Pipeline mockup) —
   *  create (api.createManualLead, POST /leads/manual, already existed
   *  with no UI anywhere calling it) then immediately promote into this
   *  pipeline (api.promoteLeadsToPipeline, same situation) so it actually
   *  shows up on this board rather than sitting unseen in Lead Room. */
  async function submitNewLead() {
    if (!newLeadName.trim()) return;
    setNewLeadSaving(true);
    setNewLeadError(null);
    try {
      const result = (await api.createManualLead({
        companyName: newLeadName.trim(),
        website: newLeadWebsite.trim() || undefined,
        email: newLeadEmail.trim() || undefined,
        industry: newLeadIndustry.trim() || undefined,
      })) as { leadId: string };
      await api.promoteLeadsToPipeline({ leadId: result.leadId });
      setNewLeadName("");
      setNewLeadWebsite("");
      setNewLeadEmail("");
      setNewLeadIndustry("");
      setNewLeadOpen(false);
      invalidateLeads();
    } catch (err) {
      setNewLeadError((err as Error).message);
    } finally {
      setNewLeadSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Ribbon-style action toolbar (Part: full UI redesign per UI.md,
          Section 6.3). Select one or more cards (checkbox, top-left of
          each) to enable Delete/Move stage/Assign/Mark done — every one
          calls a real endpoint (Move stage reuses the same
          advance-stage transition rules as a drag-drop; Assign is a new
          api.bulkAssignLeads endpoint added for this, since
          `assignedUserId` existed on Lead with nothing anywhere able to
          set it). No "Archive" or "Flag" button — neither concept exists
          anywhere in the Lead schema (no archived/flagged field), and
          this app doesn't ship controls that quietly do nothing. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] pb-3">
        <SplitPrimaryButton label="New lead" onClick={() => setNewLeadOpen((v) => !v)} disabled={newLeadSaving} />
        <span className="h-6 w-px bg-[var(--line)]" />
        <button
          type="button"
          disabled={selectedIds.size === 0 || bulkBusy}
          onClick={bulkDeleteSelected}
          className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-40"
        >
          Delete
        </button>
        <div className="relative">
          <button
            type="button"
            disabled={selectedIds.size === 0 || bulkBusy}
            onClick={() => setMoveStageOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-40"
          >
            Move stage
          </button>
          {moveStageOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded border border-[var(--line)] bg-surface py-1 shadow-lg">
              {COLUMNS.map((stage) => (
                <button
                  key={stage}
                  type="button"
                  onClick={() => bulkMoveSelected(stage)}
                  className="block w-full px-3 py-1.5 text-left text-sm text-ink/80 hover:bg-ink/5"
                >
                  {LABELS[stage] ?? stage}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="relative">
          <button
            type="button"
            disabled={selectedIds.size === 0 || bulkBusy}
            onClick={() => setAssignOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-40"
          >
            Assign
          </button>
          {assignOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded border border-[var(--line)] bg-surface py-1 shadow-lg">
              {orgUsersQuery.isLoading && <p className="px-3 py-1.5 text-xs text-ink/50">Loading…</p>}
              {orgUsersQuery.data?.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => bulkAssignSelected(u.id)}
                  className="block w-full truncate px-3 py-1.5 text-left text-sm text-ink/80 hover:bg-ink/5"
                >
                  {u.name || u.email}
                </button>
              ))}
              <button type="button" onClick={() => bulkAssignSelected(null)} className="block w-full px-3 py-1.5 text-left text-sm text-ink/50 hover:bg-ink/5">
                Unassign
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          disabled={selectedIds.size === 0 || bulkBusy}
          onClick={bulkMarkDone}
          title="Moves selected leads to Won — this app has no separate 'done' concept, Won is the real terminal stage"
          className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-40"
        >
          Mark done
        </button>
        {selectedIds.size > 0 && (
          <span className="ml-1 flex items-center gap-2 text-xs text-ink/50">
            {selectedIds.size} selected
            <button type="button" onClick={clearSelection} className="text-accent hover:underline">
              Clear
            </button>
          </span>
        )}
      </div>

      {newLeadOpen && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitNewLead();
          }}
          className="card flex flex-col gap-1 p-3"
        >
          <InlineField label="Company" value={newLeadName} onChange={setNewLeadName} placeholder="Company name" large />
          <InlineField label="Website" value={newLeadWebsite} onChange={setNewLeadWebsite} placeholder="https://…" />
          <InlineField label="Email" value={newLeadEmail} onChange={setNewLeadEmail} placeholder="contact@company.com" />
          <InlineField label="Industry" value={newLeadIndustry} onChange={setNewLeadIndustry} placeholder="e.g. Healthcare" />
          {newLeadError && <p className="mt-1 text-xs text-bad">{newLeadError}</p>}
          <div className="mt-2 flex items-center gap-2">
            <SplitPrimaryButton label={newLeadSaving ? "Adding…" : "Add lead"} onClick={submitNewLead} disabled={newLeadSaving || !newLeadName.trim()} />
            <button type="button" onClick={() => setNewLeadOpen(false)} className="text-xs text-ink/50 hover:underline">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">Pipeline</h1>
            {leadsQuery.isFetching && !leadsQuery.isLoading && <Spinner className="h-3.5 w-3.5" />}
          </div>
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
          <span className="text-xs text-ink/50">
            {filteredLeads.length} lead{filteredLeads.length === 1 ? "" : "s"}
            {sidebarFilter && ` (of ${promotedLeads.length})`}
          </span>
        </div>
      </div>

      {(error || leadsQuery.error) && (
        <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
          {error ?? (leadsQuery.error as Error).message}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-[rgb(var(--good-rgb)/0.4)] bg-[rgb(var(--good-rgb)/0.06)] px-3 py-2 text-sm text-good">
          {notice}
        </div>
      )}

      {leadsQuery.isLoading ? (
        <LoadingRow label="Loading pipeline…" />
      ) : (
      <div className="flex gap-4">
      <LeadsSidebar counts={sidebarCounts} filter={sidebarFilter} onFilterChange={setSidebarFilter} />
      <div className="flex min-w-0 flex-1 gap-3 overflow-x-auto pb-3">
        {COLUMNS.map((stage) => {
          const cards = filteredByStage.get(stage) ?? [];
          const visibleCards = cards.slice(0, visibleCountFor(stage));
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

              {stage === PipelineStage.READY_FOR_OUTREACH && (() => {
                // Deliberately byStage (the real, unfiltered column), not
                // `cards` — "Verify emails" always targets the column's
                // true full contents regardless of any active sidebar
                // view filter, so the button's own count never disagrees
                // with what verifyAllInReady() actually verifies.
                const unverifiedCount = (byStage.get(stage) ?? []).filter((l) => !l.verifiedEmail && l.email).length;
                return (
                  <div className="border-b border-[var(--line)] px-3 py-2">
                    <button
                      type="button"
                      disabled={Boolean(verifyProgress) || unverifiedCount === 0}
                      onClick={verifyAllInReady}
                      title="Re-check every unverified email in this column — a verified lead starts drafting Email 1 right away."
                      className="w-full rounded border border-[var(--line)] px-2 py-1 text-[11px] font-medium text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-40"
                    >
                      {verifyProgress
                        ? `Verifying… ${Math.round((verifyProgress.done / verifyProgress.total) * 100)}% (${verifyProgress.done}/${verifyProgress.total})`
                        : unverifiedCount > 0
                          ? `Verify ${unverifiedCount} email${unverifiedCount === 1 ? "" : "s"}`
                          : "All emails verified"}
                    </button>
                  </div>
                );
              })()}

              <div
                onScroll={(e) => handleColumnScroll(stage, e)}
                className="flex h-[65vh] flex-col gap-2 overflow-y-auto p-2"
              >
                {visibleCards.map((lead) => (
                  <article
                    key={lead.id}
                    draggable
                    onDragStart={() => setDragging(lead)}
                    onDragEnd={() => {
                      setDragging(null);
                      setHoverStage(null);
                    }}
                    className={`card card-interactive relative cursor-grab p-2.5 text-xs active:cursor-grabbing ${
                      dragging?.id === lead.id ? "drag-ghost" : ""
                    } ${busy === lead.id ? "opacity-50" : ""} ${selectedIds.has(lead.id) ? "outline outline-1 outline-accent -outline-offset-1" : ""}`}
                  >
                    <input
                      type="checkbox"
                      draggable={false}
                      checked={selectedIds.has(lead.id)}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onChange={() => toggleSelected(lead.id)}
                      className="absolute right-2 top-2 z-10"
                      aria-label={`Select ${lead.companyName}`}
                    />
                    <Link href={`/leads/${lead.id}`} className="block pr-4">
                      <div className="flex items-start gap-2">
                        <InitialsAvatar seed={lead.id} label={lead.companyName} sizeClass="h-7 w-7 shrink-0 text-[10px]" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <div className="truncate font-medium leading-snug text-ink">{lead.companyName}</div>
                            <SourceBadge source={lead.sourceLayer} />
                          </div>
                          {stage === PipelineStage.READY_FOR_OUTREACH && !lead.verifiedEmail && (
                            <span
                              className="mt-1 inline-block shrink-0 rounded-full bg-[rgb(var(--bad-rgb)/0.12)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-bad"
                              title={lead.email ? "Email not yet verified — outreach won't start until it is" : "No email on this lead"}
                            >
                              Unverified
                            </span>
                          )}
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <span className="truncate text-ink/55">{lead.industry ?? "—"}</span>
                            <span className={`tabular font-semibold ${scoreTone(lead.score?.leadScore)}`}>
                              {lead.score?.leadScore ?? "—"}
                            </span>
                          </div>
                        </div>
                      </div>
                      {lead.country && (
                        <div className="mt-1 text-[11px] text-ink/40">{lead.country}</div>
                      )}
                      <AgentActivity lead={lead} running={runningAgents[lead.id]} now={now} />
                      <StageCountdown lead={lead} now={now} />
                      <LastEmail lead={lead} now={now} />
                    </Link>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      {(() => {
                        const currentStage = (lead.pipelineState?.stage ?? "READY_FOR_OUTREACH") as PipelineStage;
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
                {visibleCards.length < cards.length && (
                  <p className="px-1 py-2 text-center text-[11px] text-ink/35">
                    Scroll for {cards.length - visibleCards.length} more…
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
      </div>
      )}
    </div>
  );
}
