"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { useRealtimeEvent } from "../lib/realtime";
import { DataTable, SectionCard, StatTile } from "./chart-kit";
import { EmailAnalyticsSection } from "./email-analytics-section";
import type { EmailListItem } from "@leadgen/types";

type EmailListEvent = "SENT" | "OPENED" | "REPLIED" | "FAILED";

const TAB_LABEL: Record<EmailListEvent, string> = {
  SENT: "Sent", OPENED: "Opened", REPLIED: "Replied", FAILED: "Failed",
};

interface SendingSessionRow {
  id: string;
  status: string;
  totalLeads: number;
  successful?: number;
  failed?: number;
  startedAt: string;
}

interface SendDashboard {
  sending: Partial<Record<"WAITING_FOR_SCHEDULE" | "READY_TO_SEND" | "SENDING" | "RETRY_SCHEDULED", number>>;
  activeSessions: SendingSessionRow[];
}

interface SendingScheduleInfo {
  schedule: { enabled: boolean; frequency: string; sendTime: string; timezone: string } | null;
  nextFireAt: string | null;
}

/**
 * Everything the user actually asked to understand at a glance (Part: Email
 * Campaign reporting, 2026-09-29): exactly how many sent/opened/failed, who
 * opened what and when, why a send failed, and how many are queued for the
 * next batch — not just aggregate rates. Wraps the existing
 * EmailAnalyticsSection (which already answers "how many/what rate") with a
 * message-level activity list and the live send queue, so both "what
 * happened" and "what's about to happen" are on one tab.
 */
export function EmailCampaignReportSection() {
  const [tab, setTab] = useState<EmailListEvent>("SENT");
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: ["email-campaign-activity", tab],
    queryFn: () => api.getEmailList(tab) as Promise<EmailListItem[]>,
  });

  const queueQuery = useQuery({
    queryKey: ["email-campaign-queue"],
    queryFn: () => api.getSendingQueueDashboard() as Promise<SendDashboard>,
  });
  const scheduleQuery = useQuery({
    queryKey: ["email-campaign-schedule"],
    queryFn: () => api.getSendingSchedule() as Promise<SendingScheduleInfo>,
  });

  const invalidateActivity = () => queryClient.invalidateQueries({ queryKey: ["email-campaign-activity"] });
  const invalidateQueue = () => queryClient.invalidateQueries({ queryKey: ["email-campaign-queue"] });
  useRealtimeEvent("email.sent", () => { invalidateActivity(); invalidateQueue(); });
  useRealtimeEvent("email.failed", () => { invalidateActivity(); invalidateQueue(); });
  useRealtimeEvent("email.opened", invalidateActivity);
  useRealtimeEvent("sendingQueue.updated", invalidateQueue);
  useRealtimeEvent("sendingSession.updated", invalidateQueue);

  const items = listQuery.data ?? [];
  const sending = queueQuery.data?.sending ?? {};
  const waitingForBatch = sending.WAITING_FOR_SCHEDULE ?? 0;
  const readyToSend = sending.READY_TO_SEND ?? 0;
  const inFlight = sending.SENDING ?? 0;
  const retrying = sending.RETRY_SCHEDULED ?? 0;
  const nextFireAt = scheduleQuery.data?.nextFireAt;
  const scheduleEnabled = scheduleQuery.data?.schedule?.enabled ?? false;

  return (
    <div className="flex flex-col gap-5">
      <EmailAnalyticsSection />

      <SectionCard
        title="Send queue"
        subtitle="What's queued right now and when the next batch actually goes out — live, not a historical stat."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label={scheduleEnabled ? "Waiting for next batch" : "Waiting for schedule"}
            value={waitingForBatch}
            tone={waitingForBatch > 0 ? "gold" : undefined}
          />
          <StatTile label="Ready to send now" value={readyToSend} />
          <StatTile label="Sending right now" value={inFlight} tone={inFlight > 0 ? "gold" : undefined} />
          <StatTile label="Retrying after failure" value={retrying} tone={retrying > 0 ? "bad" : "good"} />
        </div>
        <p className="mt-3 text-xs text-ink/55">
          {scheduleEnabled
            ? nextFireAt
              ? `Next batch fires ${new Date(nextFireAt).toLocaleString()} — ${waitingForBatch} message(s) will go out then (fewer if a mailbox's daily limit is reached first).`
              : "A sending schedule is on, but its next fire time couldn't be computed — check Settings."
            : "No sending schedule configured — fully-prepared emails send immediately, no batch to wait for."}
        </p>

        {(queueQuery.data?.activeSessions?.length ?? 0) > 0 && (
          <div className="mt-4 border-t border-[var(--line)] pt-3">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/55">
              Active batches ({queueQuery.data!.activeSessions.length})
            </h3>
            <ul className="flex flex-col gap-1.5">
              {queueQuery.data!.activeSessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between text-xs">
                  <span className="text-ink/70">
                    Started {new Date(s.startedAt).toLocaleTimeString()} — {s.status}
                  </span>
                  <span className="tabular text-ink/55">
                    {s.successful ?? 0} sent / {s.failed ?? 0} failed / {s.totalLeads} total
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Message activity"
        subtitle="Every individual email, who it went to, and exactly what happened — the detail behind the rates above."
        actions={
          <div className="flex rounded-lg border border-[var(--line)] p-0.5">
            {(Object.keys(TAB_LABEL) as EmailListEvent[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                aria-pressed={tab === t}
                className={`rounded-md px-3 py-1 text-xs transition-colors ${
                  tab === t ? "bg-ink/10 font-medium text-ink" : "text-ink/60 hover:bg-ink/5"
                }`}
              >
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>
        }
      >
        {listQuery.isLoading ? (
          <p className="py-8 text-center text-sm text-ink/50">Loading…</p>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink/50">No emails {TAB_LABEL[tab].toLowerCase()} yet.</p>
        ) : (
          <DataTable<EmailListItem>
            rows={items}
            rowKey={(r) => r.id}
            columns={[
              {
                key: "company", header: "Company",
                render: (r) => <a href={`/leads/${r.leadId}`} className="hover:underline">{r.companyName}</a>,
              },
              { key: "contact", header: "Contact", render: (r) => r.contactName ?? "—" },
              { key: "subject", header: "Subject", render: (r) => r.subject },
              { key: "step", header: "Step", numeric: true, render: (r) => r.sequenceStep },
              { key: "sentAt", header: "Sent", render: (r) => (r.sentAt ? new Date(r.sentAt).toLocaleString() : "—") },
              ...(tab === "SENT"
                ? []
                : [{
                    key: "eventAt",
                    header: tab === "OPENED" ? "Opened" : tab === "REPLIED" ? "Replied" : "Failed",
                    render: (r: EmailListItem) => new Date(r.eventAt).toLocaleString(),
                  }]),
              ...(tab === "FAILED"
                ? [{ key: "failureReason", header: "Why", render: (r: EmailListItem) => r.failureReason ?? "Unknown" }]
                : []),
            ]}
          />
        )}
      </SectionCard>
    </div>
  );
}
