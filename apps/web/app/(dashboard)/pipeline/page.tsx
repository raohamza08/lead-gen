"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api-client";
import { ALLOWED_TRANSITIONS, PipelineStage } from "@leadgen/types";
import type { Lead, LeadScore } from "@leadgen/types";

interface LeadRow extends Lead {
  score: LeadScore | null;
  pipelineState: { stage: string; previousStage: string | null } | null;
}

const LABELS: Record<string, string> = {
  NEW_LEAD: "New Lead",
  VERIFIED: "Verified",
  RESEARCH_COMPLETED: "Research Done",
  UNDER_REVIEW: "Under Review",
  READY_FOR_OUTREACH: "Ready",
  EMAIL_1_SENT: "Email 1 Sent",
  WAITING_2_DAYS: "Waiting 2d",
  EMAIL_2_SENT: "Email 2 Sent",
  WAITING_1_2_DAYS: "Waiting 1-2d",
  GEMINI_DRAFTING: "Drafting",
  PERSONALIZED_PITCH: "Pitch Sent",
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
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<LeadRow | null>(null);
  const [hoverStage, setHoverStage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    api
      .getLeads({ pageSize: "200" })
      .then((res: any) => setLeads(res.items ?? res))
      .catch((err) => setError((err as Error).message));
  }

  useEffect(load, []);

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
    const previous = leads;
    setLeads((rows) =>
      rows.map((r) => (r.id === lead.id ? { ...r, pipelineState: { stage, previousStage: from } } : r)),
    );

    try {
      await api.advanceStage(lead.id, stage);
      load();
    } catch (err) {
      setLeads(previous);
      setError(`Could not move ${lead.companyName}: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  /** Undo one step — swaps stage<->previousStage server-side. Also how a
   *  failed automated send (e.g. no mailbox configured yet) gets retried:
   *  back to Ready, then forward again. */
  async function moveBack(lead: LeadRow, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(lead.id);
    setError(null);
    try {
      await api.moveBack(lead.id);
      load();
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
      setLeads((rows) => rows.filter((r) => r.id !== lead.id));
    } catch (err) {
      setError(`Could not delete ${lead.companyName}: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Pipeline</h1>
          <p className="mt-0.5 text-xs text-ink/55">
            Drag a card to move it. Only valid next stages accept a drop — the same rules the
            automation follows, so a manual move can&apos;t create a state the sequencer won&apos;t
            understand.
          </p>
        </div>
        <span className="text-xs text-ink/50">{leads.length} leads</span>
      </div>

      {error && (
        <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
          {error}
        </div>
      )}

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
                      <div className="font-medium leading-snug text-ink">{lead.companyName}</div>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <span className="truncate text-ink/55">{lead.industry ?? "—"}</span>
                        <span className={`tabular font-semibold ${scoreTone(lead.score?.leadScore)}`}>
                          {lead.score?.leadScore ?? "—"}
                        </span>
                      </div>
                      {lead.country && (
                        <div className="mt-1 text-[11px] text-ink/40">{lead.country}</div>
                      )}
                    </Link>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      {lead.pipelineState?.previousStage && (
                        <button
                          type="button"
                          disabled={busy === lead.id}
                          onClick={(e) => moveBack(lead, e)}
                          title={`Move back to ${LABELS[lead.pipelineState.previousStage] ?? lead.pipelineState.previousStage}`}
                          className="rounded border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-ink/50 transition-colors hover:bg-ink/5 hover:text-ink/80 disabled:opacity-50"
                        >
                          ← Back
                        </button>
                      )}
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
    </div>
  );
}
