"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../lib/api-client";
import { useRealtimeEvent } from "../lib/realtime";
import {
  AXIS_PROPS,
  ChartWithTable,
  DataTable,
  GRID_PROPS,
  Legend,
  SERIES,
  StatTile,
  TOOLTIP_STYLE,
} from "./chart-kit";

type DateRangeName =
  | "TODAY" | "YESTERDAY" | "THIS_WEEK" | "LAST_WEEK" | "THIS_MONTH" | "LAST_MONTH"
  | "LAST_30_DAYS" | "LAST_90_DAYS" | "CUSTOM" | "ALL_TIME";

const RANGE_OPTIONS: { value: DateRangeName; label: string }[] = [
  { value: "TODAY", label: "Today" },
  { value: "YESTERDAY", label: "Yesterday" },
  { value: "THIS_WEEK", label: "This Week" },
  { value: "LAST_WEEK", label: "Last Week" },
  { value: "THIS_MONTH", label: "This Month" },
  { value: "LAST_MONTH", label: "Last Month" },
  { value: "LAST_30_DAYS", label: "Last 30 Days" },
  { value: "LAST_90_DAYS", label: "Last 90 Days" },
  { value: "CUSTOM", label: "Custom Range" },
  { value: "ALL_TIME", label: "All Time" },
];

interface EmailPerformance {
  sent: number;
  delivered: number;
  uniqueLeadsOpened: number;
  uniqueLeadsReplied: number;
  failed: number;
  bounced: number;
  openRate: number;
  replyRate: number;
  failureRate: number;
}

interface UserBreakdownRow extends EmailPerformance {
  userId: string;
  userName: string;
  leadsUploaded: number;
}

const TREND_METRICS = [
  { key: "leadsUploaded", metric: "LEADS_UPLOADED", label: "Leads uploaded", color: SERIES[0] },
  { key: "emailsSent", metric: "EMAILS_SENT", label: "Emails sent", color: SERIES[1] },
  { key: "emailsOpened", metric: "EMAILS_OPENED", label: "Opened", color: SERIES[2] },
  { key: "replies", metric: "REPLIES", label: "Replies", color: SERIES[3] },
] as const;

const pct = (n: number) => `${n}%`;

/**
 * Part 10's dashboard, plus the realtime updates Part 16 asks for — every
 * count here comes from persistent EmailEvent/EmailMessage/Lead rows for the
 * selected range (Part: Lead Upload Analytics / Email Performance / Ignore
 * Groups, 2026-09-01), never from a frontend running total. Team/user
 * breakdown is requested unconditionally; the backend decides how much of
 * it a non-privileged caller actually gets back (one row, their own), so
 * this component never has to duplicate that permission check.
 */
export function EmailAnalyticsSection() {
  const [range, setRange] = useState<DateRangeName>("LAST_30_DAYS");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const queryClient = useQueryClient();

  const params = useMemo(() => {
    const p: Record<string, string> = { range };
    if (range === "CUSTOM") {
      if (customFrom) p.from = customFrom;
      if (customTo) p.to = customTo;
    }
    return p;
  }, [range, customFrom, customTo]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["email-analytics"] });
  };
  // Every event that can move one of this section's numbers — no separate
  // "analytics.updated" broadcast invented; these already fire at exactly
  // the right moments (Part 16: no page refresh required).
  useRealtimeEvent("email.sent", invalidateAll);
  useRealtimeEvent("email.failed", invalidateAll);
  useRealtimeEvent("email.opened", invalidateAll);
  useRealtimeEvent("lead.stageChanged", invalidateAll);
  useRealtimeEvent("lead.import.completed", invalidateAll);

  const leadUploadsQuery = useQuery({
    queryKey: ["email-analytics", "lead-uploads", params],
    queryFn: () => api.getLeadUploadStats(params) as Promise<{ total: number }>,
  });
  const performanceQuery = useQuery({
    queryKey: ["email-analytics", "performance", params],
    queryFn: () => api.getEmailPerformance(params) as Promise<EmailPerformance>,
  });
  const failureQuery = useQuery({
    queryKey: ["email-analytics", "failures", params],
    queryFn: () => api.getFailureBreakdown(params) as Promise<Record<string, number>>,
  });
  const breakdownQuery = useQuery({
    queryKey: ["email-analytics", "breakdown", params],
    queryFn: () => api.getUserBreakdown(params) as Promise<UserBreakdownRow[]>,
  });
  const trendsQuery = useQuery({
    queryKey: ["email-analytics", "trends", range],
    // Trends intentionally ignore CUSTOM's exact bounds and always show the
    // chosen range's own natural window — a one-day "Today" trend chart
    // isn't useful, so this always asks for a real multi-day series.
    queryFn: async () => {
      const results = await Promise.all(
        TREND_METRICS.map((m) =>
          api.getAnalyticsTrends({ range: range === "CUSTOM" ? "LAST_30_DAYS" : range, metric: m.metric }) as Promise<
            { date: string; count: number }[]
          >,
        ),
      );
      const byDate = new Map<string, Record<string, number | string>>();
      TREND_METRICS.forEach((m, i) => {
        for (const point of results[i]) {
          const row = byDate.get(point.date) ?? { date: point.date };
          row[m.key] = point.count;
          byDate.set(point.date, row);
        }
      });
      return Array.from(byDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    },
  });

  const performance = performanceQuery.data;
  const leadsUploaded = leadUploadsQuery.data?.total ?? 0;
  const failures = failureQuery.data ?? {};
  const breakdown = breakdownQuery.data ?? [];
  const trends = trendsQuery.data ?? [];

  return (
    <section className="card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Email Analytics</h2>
          <p className="mt-0.5 text-xs text-ink/55">
            Lead uploads and email performance, from persisted event history — never inferred from a
            lead&apos;s current status alone.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as DateRangeName)}
            className="rounded-md border border-[var(--line)] bg-transparent px-2.5 py-1.5 text-xs"
          >
            {RANGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {range === "CUSTOM" && (
            <>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="rounded-md border border-[var(--line)] bg-transparent px-2 py-1.5 text-xs" />
              <span className="text-ink/40">to</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="rounded-md border border-[var(--line)] bg-transparent px-2 py-1.5 text-xs" />
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Leads Uploaded" value={leadsUploaded} />
        <StatTile label="Emails Sent" value={performance?.sent ?? "—"} />
        <StatTile label="Delivered" value={performance?.delivered ?? "—"} />
        <StatTile label="Verified Opens" value={performance?.uniqueLeadsOpened ?? "—"} />
        <StatTile label="Replies" value={performance?.uniqueLeadsReplied ?? "—"} />
        <StatTile label="Failed" value={performance?.failed ?? "—"} tone={(performance?.failed ?? 0) > 0 ? "bad" : "good"} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <StatTile
          label="Open Rate"
          value={performance ? pct(performance.openRate) : "—"}
          hint="Unique verified opens ÷ delivered (or sent)"
        />
        <StatTile
          label="Reply Rate"
          value={performance ? pct(performance.replyRate) : "—"}
          hint="Unique leads replied ÷ delivered (or sent)"
        />
        <StatTile
          label="Failure Rate"
          value={performance ? pct(performance.failureRate) : "—"}
          tone={(performance?.failureRate ?? 0) > 10 ? "bad" : undefined}
          hint="Failed ÷ attempted sends"
        />
      </div>

      {Object.values(failures).some((v) => v > 0) && (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/55">Sending Failures</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(failures)
              .filter(([, count]) => count > 0)
              .map(([label, count]) => (
                <span key={label} className="rounded-full bg-bad/10 px-3 py-1 text-xs text-bad">
                  {label}: {count}
                </span>
              ))}
          </div>
        </div>
      )}

      <div className="mt-5">
        <ChartWithTable
          title="Trends"
          subtitle="Daily activity for the selected window."
          chart={
            <>
              <Legend items={TREND_METRICS.map((m) => ({ label: m.label, color: m.color }))} />
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trends} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="date" {...AXIS_PROPS} minTickGap={24} tickFormatter={(d: string) => d.slice(5)} />
                    <YAxis allowDecimals={false} width={40} {...AXIS_PROPS} />
                    <Tooltip {...TOOLTIP_STYLE} />
                    {TREND_METRICS.map((m) => (
                      <Line
                        key={m.key}
                        type="monotone"
                        dataKey={m.key}
                        name={m.label}
                        stroke={m.color}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--paper)" }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          }
          table={
            <DataTable<Record<string, number | string>>
              rows={[...trends].reverse()}
              rowKey={(r) => String(r.date)}
              columns={[
                { key: "date", header: "Date", render: (r) => String(r.date) },
                ...TREND_METRICS.map((m) => ({
                  key: m.key,
                  header: m.label,
                  numeric: true,
                  render: (r: Record<string, number | string>) => r[m.key] ?? 0,
                })),
              ]}
            />
          }
        />
      </div>

      <div className="mt-5">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/55">
          {breakdown.length > 1 ? "Team Breakdown" : "My Statistics"}
        </h3>
        {breakdownQuery.isLoading ? (
          <p className="py-6 text-center text-sm text-ink/50">Loading…</p>
        ) : breakdown.length === 0 ? (
          // Shown instead of hiding the section entirely — an empty state is
          // how someone finds out this exists at all, before anyone has
          // uploaded a lead through the app yet (this table only ever
          // includes users who have uploaded at least one, ever).
          <p className="py-6 text-center text-sm text-ink/50">
            No leads have been uploaded through the app yet. Once someone adds or imports a lead, their
            per-user stats will appear here.
          </p>
        ) : (
          <DataTable<UserBreakdownRow>
            rows={breakdown}
            rowKey={(r) => r.userId}
            columns={[
              { key: "user", header: "User", render: (r) => r.userName },
              { key: "leadsUploaded", header: "Leads Uploaded", numeric: true, render: (r) => r.leadsUploaded },
              { key: "sent", header: "Emails Sent", numeric: true, render: (r) => r.sent },
              { key: "opened", header: "Verified Opens", numeric: true, render: (r) => r.uniqueLeadsOpened },
              { key: "replied", header: "Replies", numeric: true, render: (r) => r.uniqueLeadsReplied },
              { key: "openRate", header: "Open Rate", numeric: true, render: (r) => pct(r.openRate) },
              { key: "replyRate", header: "Reply Rate", numeric: true, render: (r) => pct(r.replyRate) },
              { key: "failed", header: "Failures", numeric: true, render: (r) => r.failed },
            ]}
          />
        )}
      </div>
    </section>
  );
}
