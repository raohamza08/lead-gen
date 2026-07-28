"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../../../lib/api-client";
import {
  AXIS_PROPS,
  ChartWithTable,
  DataTable,
  GRID_PROPS,
  Legend,
  SERIES,
  SINGLE_SERIES,
  StatTile,
  TOOLTIP_STYLE,
  formatCompact,
} from "../../../components/chart-kit";
import type {
  CohortTrendPoint,
  CohortTrendsReport,
  EmailFunnelReport,
  EmailStepPerformance,
  LinkedinFunnelReport,
  RevenuePipelineReport,
  RevenuePipelineStage,
} from "@leadgen/types";

const TREND_WINDOWS = [7, 30, 90] as const;

/** Sequence steps are 1-3 by design (intro / case study / Gemini pitch). */
const STEP_LABELS: Record<number, string> = {
  1: "Email 1 — intro",
  2: "Email 2 — case study",
  3: "Email 3 — Gemini pitch",
};

const money = (n: number) => `$${formatCompact(n)}`;
const pct = (n: number) => `${n}%`;
const stageLabel = (stage: string) =>
  stage.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

/**
 * The four trend series, in fixed slot order. The index is pinned to the
 * series identity, not its position in a filtered list, so hiding one never
 * repaints the others.
 */
const TREND_SERIES = [
  { key: "leadsCreated", label: "Leads created", color: SERIES[0] },
  { key: "emailsSent", label: "Emails sent", color: SERIES[1] },
  { key: "replies", label: "Replies", color: SERIES[2] },
  { key: "meetingsBooked", label: "Meetings booked", color: SERIES[3] },
] as const;

export default function AnalyticsPage() {
  const [days, setDays] = useState<number>(30);
  const [email, setEmail] = useState<EmailFunnelReport | null>(null);
  const [linkedin, setLinkedin] = useState<LinkedinFunnelReport | null>(null);
  const [revenue, setRevenue] = useState<RevenuePipelineReport | null>(null);
  const [trends, setTrends] = useState<CohortTrendsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRefreshing(true);
    Promise.all([
      api.getEmailFunnel(),
      api.getLinkedinFunnel(),
      api.getRevenuePipeline(),
      api.getCohortTrends(days),
    ])
      .then(([e, l, r, t]) => {
        if (cancelled) return;
        setEmail(e as EmailFunnelReport);
        setLinkedin(l as LinkedinFunnelReport);
        setRevenue(r as RevenuePipelineReport);
        setTrends(t as CohortTrendsReport);
        setError(null);
      })
      .catch((err) => !cancelled && setError((err as Error).message))
      .finally(() => !cancelled && setRefreshing(false));
    return () => {
      cancelled = true;
    };
  }, [days]);

  if (error) return <p className="text-bad">{error}</p>;
  if (!email || !linkedin || !revenue || !trends) return <p className="text-ink/60">Loading…</p>;

  const o = email.overall;
  // Sent -> Delivered -> Opened -> Clicked -> Replied is an ordered funnel, so
  // it's one series in one colour; the bar length already encodes magnitude and
  // a per-bar ramp would double-encode it.
  const emailFunnelBars = [
    { stage: "Sent", count: o.sent },
    { stage: "Delivered", count: o.delivered },
    { stage: "Opened", count: o.opened },
    { stage: "Clicked", count: o.clicked },
    { stage: "Replied", count: o.replied },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* One filter row, above the cards it scopes. The snapshot reports below
          are point-in-time by nature and are labelled as such rather than
          pretending to honour a window they don't have. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-ink/55">Trend window</span>
        <div className="flex rounded-lg border border-[var(--line)] p-0.5">
          {TREND_WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setDays(w)}
              aria-pressed={days === w}
              className={`rounded-md px-3 py-1 text-xs transition-colors ${
                days === w ? "bg-ink/10 font-medium text-ink" : "text-ink/60 hover:bg-ink/5"
              }`}
            >
              {w}d
            </button>
          ))}
        </div>
      </div>

      {/* Hold the previous render at reduced opacity while refetching — a
          skeleton here would jump the layout on every window change. */}
      <div className={`flex flex-col gap-6 transition-opacity ${refreshing ? "opacity-60" : ""}`}>
        <section>
          <h2 className="mb-3 text-sm font-semibold tracking-tight">Email performance</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Sent" value={formatCompact(o.sent)} />
            <StatTile label="Delivery rate" value={pct(o.deliveryRate)} hint={`${o.delivered} delivered`} />
            <StatTile label="Open rate" value={pct(o.openRate)} hint={`${o.notOpened} not opened`} />
            <StatTile label="Reply rate" value={pct(o.replyRate)} tone={o.replied > 0 ? "good" : undefined} />
            <StatTile
              label="Bounced"
              value={formatCompact(o.bounced)}
              tone={o.bounced > 0 ? "bad" : undefined}
            />
            <StatTile
              label="Spam / unsub"
              value={`${o.spamComplaints} / ${o.unsubscribed}`}
              tone={o.spamComplaints > 0 ? "bad" : undefined}
            />
          </div>
        </section>

        <ChartWithTable
          title="Email funnel"
          subtitle="All time. Counts are per message — repeat opens of the same email count once."
          chart={
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={emailFunnelBars} margin={{ top: 16, right: 8, left: 0, bottom: 8 }}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="stage" {...AXIS_PROPS} />
                  <YAxis allowDecimals={false} width={44} {...AXIS_PROPS} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Bar dataKey="count" fill={SINGLE_SERIES} radius={[4, 4, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          }
          table={
            <DataTable<EmailStepPerformance>
              rows={email.bySequenceStep}
              rowKey={(r) => String(r.step)}
              columns={[
                { key: "step", header: "Step", render: (r) => STEP_LABELS[r.step] ?? `Step ${r.step}` },
                { key: "queued", header: "Queued", numeric: true, render: (r) => r.queued },
                { key: "sent", header: "Sent", numeric: true, render: (r) => r.sent },
                { key: "delivered", header: "Delivered", numeric: true, render: (r) => r.delivered },
                { key: "opened", header: "Opened", numeric: true, render: (r) => r.opened },
                { key: "notOpened", header: "Not opened", numeric: true, render: (r) => r.notOpened },
                { key: "clicked", header: "Clicked", numeric: true, render: (r) => r.clicked },
                { key: "replied", header: "Replied", numeric: true, render: (r) => r.replied },
                { key: "bounced", header: "Bounced", numeric: true, render: (r) => r.bounced },
                { key: "spam", header: "Spam", numeric: true, render: (r) => r.spamComplaints },
                { key: "unsub", header: "Unsub", numeric: true, render: (r) => r.unsubscribed },
                { key: "blocked", header: "Blocked", numeric: true, render: (r) => r.blocked },
                { key: "failed", header: "Failed", numeric: true, render: (r) => r.failed },
                { key: "deliveryRate", header: "Delivery %", numeric: true, render: (r) => pct(r.deliveryRate) },
                { key: "openRate", header: "Open %", numeric: true, render: (r) => pct(r.openRate) },
                { key: "clickRate", header: "Click %", numeric: true, render: (r) => pct(r.clickRate) },
                { key: "replyRate", header: "Reply %", numeric: true, render: (r) => pct(r.replyRate) },
                { key: "meetingRate", header: "Meeting %", numeric: true, render: (r) => pct(r.meetingRate) },
                { key: "conversionRate", header: "Conv %", numeric: true, render: (r) => pct(r.conversionRate) },
              ]}
            />
          }
        />

        <ChartWithTable
          title="Cohort trends"
          subtitle={`Daily activity over the last ${trends.days} days (UTC).`}
          chart={
            <>
              <Legend items={TREND_SERIES.map((s) => ({ label: s.label, color: s.color }))} />
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trends.points} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis
                      dataKey="date"
                      {...AXIS_PROPS}
                      minTickGap={24}
                      tickFormatter={(d: string) => d.slice(5)}
                    />
                    <YAxis allowDecimals={false} width={44} {...AXIS_PROPS} />
                    <Tooltip {...TOOLTIP_STYLE} />
                    {TREND_SERIES.map((s) => (
                      <Line
                        key={s.key}
                        type="monotone"
                        dataKey={s.key}
                        name={s.label}
                        stroke={s.color}
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
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
            <DataTable<CohortTrendPoint>
              rows={[...trends.points].reverse()}
              rowKey={(r) => r.date}
              columns={[
                { key: "date", header: "Date", render: (r) => r.date },
                { key: "leadsCreated", header: "Leads", numeric: true, render: (r) => r.leadsCreated },
                { key: "verifiedLeads", header: "Verified", numeric: true, render: (r) => r.verifiedLeads },
                { key: "emailsSent", header: "Emails sent", numeric: true, render: (r) => r.emailsSent },
                { key: "replies", header: "Replies", numeric: true, render: (r) => r.replies },
                { key: "meetingsBooked", header: "Meetings", numeric: true, render: (r) => r.meetingsBooked },
                { key: "avgLeadScore", header: "Avg score", numeric: true, render: (r) => r.avgLeadScore },
              ]}
            />
          }
        />

        <section>
          <h2 className="mb-3 text-sm font-semibold tracking-tight">Revenue pipeline</h2>
          {/* The one hero figure on this view. */}
          <div className="mb-3 rounded-xl border border-[var(--line)] px-5 py-4">
            <div className="text-[11px] uppercase tracking-wide text-ink/55">Open pipeline value</div>
            <div className="mt-1 text-5xl font-semibold tracking-tight">
              {money(revenue.openPipelineValue)}
            </div>
            <div className="mt-1 text-xs text-ink/45">
              Excludes won and lost. Reviewer estimates take precedence over AI estimates.
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Won" value={money(revenue.wonValue)} tone="good" />
            <StatTile label="Lost" value={money(revenue.lostValue)} tone={revenue.lostValue > 0 ? "bad" : undefined} />
            <StatTile label="Win rate" value={pct(revenue.winRate)} />
            <StatTile label="Avg deal" value={money(revenue.avgDealValue)} />
          </div>
        </section>

        <ChartWithTable
          title="Pipeline value by stage"
          subtitle="All time. Every stage is shown, including empty ones."
          chart={
            <div className="h-[420px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={revenue.stages.map((s) => ({ ...s, label: stageLabel(s.stage) }))}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
                >
                  <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
                  <XAxis type="number" {...AXIS_PROPS} tickFormatter={(v: number) => money(v)} />
                  <YAxis type="category" dataKey="label" width={140} {...AXIS_PROPS} />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => money(v)} />
                  <Bar dataKey="value" fill={SINGLE_SERIES} radius={[0, 4, 4, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          }
          table={
            <DataTable<RevenuePipelineStage>
              rows={revenue.stages}
              rowKey={(r) => r.stage}
              columns={[
                { key: "stage", header: "Stage", render: (r) => stageLabel(r.stage) },
                { key: "count", header: "Leads", numeric: true, render: (r) => r.count },
                { key: "value", header: "Value", numeric: true, render: (r) => money(r.value) },
              ]}
            />
          }
        />

        <ChartWithTable
          title="LinkedIn outreach"
          subtitle="Manually logged — outreach is never automated, so an empty report means nothing was recorded, not that a sync is broken."
          chart={
            linkedin.totalTracked === 0 ? (
              <p className="py-8 text-center text-sm text-ink/50">No LinkedIn activity recorded yet.</p>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={linkedin.statusCounts.map((s) => ({ ...s, label: stageLabel(s.status) }))}
                    margin={{ top: 16, right: 8, left: 0, bottom: 8 }}
                  >
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="label" {...AXIS_PROPS} />
                    <YAxis allowDecimals={false} width={44} {...AXIS_PROPS} />
                    <Tooltip {...TOOLTIP_STYLE} />
                    <Bar dataKey="count" fill={SINGLE_SERIES} radius={[4, 4, 0, 0]} maxBarSize={24} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )
          }
          table={
            <DataTable<{ status: string; count: number }>
              rows={linkedin.statusCounts}
              rowKey={(r) => r.status}
              columns={[
                { key: "status", header: "Status", render: (r) => stageLabel(r.status) },
                { key: "count", header: "Leads", numeric: true, render: (r) => r.count },
              ]}
            />
          }
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Tracked on LinkedIn" value={linkedin.totalTracked} />
          <StatTile label="Acceptance rate" value={pct(linkedin.acceptanceRate)} />
          <StatTile label="Reply rate" value={pct(linkedin.replyRate)} />
          <StatTile label="Meeting rate" value={pct(linkedin.meetingRate)} />
        </div>
      </div>
    </div>
  );
}
