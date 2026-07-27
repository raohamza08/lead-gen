"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api-client";
import type { Lead, LeadScore } from "@leadgen/types";

interface LeadRow extends Lead {
  score: LeadScore | null;
  pipelineState: { stage: string } | null;
}

/** Mirrors CLICKUP_STATUS_MAP in apps/api/src/sync/clickup-sync.worker.ts — same labels, same order. */
const COLUMNS: { stage: string; label: string }[] = [
  { stage: "NEW_LEAD", label: "New Lead" },
  { stage: "UNDER_REVIEW", label: "Under Review" },
  { stage: "READY_FOR_OUTREACH", label: "Ready for Outreach" },
  { stage: "EMAIL_1_SENT", label: "Email 1 Sent" },
  { stage: "WAITING_2_DAYS", label: "Waiting (2 Days)" },
  { stage: "EMAIL_2_SENT", label: "Email 2 Sent" },
  { stage: "WAITING_1_2_DAYS", label: "Waiting (1-2 Days)" },
  { stage: "PERSONALIZED_PITCH", label: "Personalized Pitch" },
  { stage: "LINKEDIN_OUTREACH", label: "LinkedIn Outreach" },
  { stage: "REPLIED", label: "Replied" },
  { stage: "MEETING_BOOKED", label: "Meeting Booked" },
  { stage: "PROPOSAL_SENT", label: "Proposal Sent" },
  { stage: "WON", label: "Won" },
  { stage: "LOST", label: "Lost" },
];

/** Read-through, not a fork of truth (Part F1) — real stage changes happen via ClickUp or the sequencer. */
export default function PipelinePage() {
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getLeads({ pageSize: "200" })
      .then((res: any) => setLeads(res.items))
      .catch((err) => setError((err as Error).message));
  }, []);

  const byStage = useMemo(() => {
    const grouped = new Map<string, LeadRow[]>();
    for (const lead of leads) {
      const stage = lead.pipelineState?.stage ?? "NEW_LEAD";
      if (!grouped.has(stage)) grouped.set(stage, []);
      grouped.get(stage)!.push(lead);
    }
    return grouped;
  }, [leads]);

  if (error) return <p className="text-bad">{error}</p>;

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {COLUMNS.map((col) => {
        const cards = byStage.get(col.stage) ?? [];
        return (
          <div key={col.stage} className="flex w-64 shrink-0 flex-col rounded-lg border border-[var(--line)]">
            <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2">
              <span className="text-xs font-medium uppercase tracking-wide text-ink/60">{col.label}</span>
              <span className="tabular rounded bg-black/5 px-1.5 py-0.5 text-xs">{cards.length}</span>
            </div>
            <div className="flex flex-col gap-2 p-2">
              {cards.map((lead) => (
                <Link
                  key={lead.id}
                  href={`/leads/${lead.id}`}
                  className="rounded border border-[var(--line)] p-2 text-xs hover:bg-black/5"
                >
                  <div className="font-medium text-ink">{lead.companyName}</div>
                  <div className="mt-1 flex items-center justify-between text-ink/60">
                    <span>{lead.industry ?? "—"}</span>
                    <span className="tabular">{lead.score?.leadScore ?? "—"}</span>
                  </div>
                </Link>
              ))}
              {cards.length === 0 && <p className="px-1 py-3 text-center text-xs text-ink/40">Empty</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
