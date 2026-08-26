"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
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
  EmailImprovement,
  EmailListItem,
  EmailStepPerformance,
  LinkedinFunnelReport,
} from "@leadgen/types";

const TREND_WINDOWS = [7, 30, 90] as const;

/** Sequence steps are 1-3 by design (intro / case study / Gemini pitch). */
const STEP_LABELS: Record<number, string> = {
  1: "Email 1 — intro",
  2: "Email 2 — case study",
  3: "Email 3 — Gemini pitch",
};

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

interface AiInsights {
  generatedAt?: string;
  insights: {
    summary?: string;
    bestCampaigns?: { name: string; why: string }[];
    underperforming?: { name: string; why: string; suggestedFix: string }[];
    warnings?: string[];
    confidence?: string;
  };
  recommendations: {
    icpRecommendations?: { change: string; evidence: string; confidence: string }[];
    messagingRecommendations?: { change: string; evidence: string; confidence: string }[];
    stopDoing?: string[];
    sampleSizeWarning?: string | null;
  };
  emailImprovements?: EmailImprovement[];
  /** Only present right after "Run analysis" — the persisted snapshot a page
   *  reload loads doesn't carry these ephemeral run diagnostics. */
  notes?: string[];
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function AnalyticsPage() {
  const [days, setDays] = useState<number>(30);
  const [emailTab, setEmailTab] = useState<"OPENED" | "REPLIED">("OPENED");
  // Overrides the persisted latest-run query below once a manual run
  // finishes -- a fresh run's ephemeral `notes` field must win over whatever
  // was last persisted, without needing to invalidate/refetch that query.
  const [manualInsights, setManualInsights] = useState<AiInsights | null>(null);

  // Cached per `days` window: switching between 7d/30d/90d and back shows
  // each window instantly from cache while quietly re-verifying.
  const funnelQuery = useQuery({
    queryKey: ["analytics-funnel", days],
    queryFn: async () => {
      const [e, l, t] = await Promise.all([api.getEmailFunnel(), api.getLinkedinFunnel(), api.getCohortTrends(days)]);
      return { email: e as EmailFunnelReport, linkedin: l as LinkedinFunnelReport, trends: t as CohortTrendsReport };
    },
  });

  // The last real analysis, persisted server-side — loads on mount instead
  // of only appearing after a manual "Run analysis" click, so navigating
  // away and back doesn't lose it. No persisted run yet (or a fetch blip)
  // just means aiInsights stays null — the manual button still works.
  const latestInsightsQuery = useQuery({
    queryKey: ["analytics-latest-insights"],
    queryFn: () => api.getLatestAiInsights() as Promise<AiInsights | null>,
    retry: false,
  });

  const emailListQuery = useQuery({
    queryKey: ["analytics-email-list", emailTab],
    queryFn: () => api.getEmailList(emailTab) as Promise<EmailListItem[]>,
  });

  const runInsightsMutation = useMutation({
    mutationFn: () => api.getAiInsights() as Promise<AiInsights>,
    onSuccess: setManualInsights,
  });
  function runAiInsights() {
    runInsightsMutation.mutate();
  }
  const aiInsights = manualInsights ?? latestInsightsQuery.data ?? null;
  const aiLoading = runInsightsMutation.isPending;
  const aiError = runInsightsMutation.error ? (runInsightsMutation.error as Error).message : null;

  const emailList = emailListQuery.data ?? null;
  const emailListLoading = emailListQuery.isLoading;
  const emailListError = emailListQuery.error ? (emailListQuery.error as Error).message : null;

  const refreshing = funnelQuery.isFetching;

  if (funnelQuery.error) return <p className="text-bad">{(funnelQuery.error as Error).message}</p>;
  if (!funnelQuery.data) return <p className="text-ink/60">Loading…</p>;
  const { email, linkedin, trends } = funnelQuery.data;

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
        <section className="rounded-xl border border-[var(--line)] p-5">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight">AI insights</h2>
            <button
              onClick={runAiInsights}
              disabled={aiLoading}
              className="rounded-md bg-accent px-3 py-1.5 text-xs text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {aiLoading ? "Analysing…" : "Run analysis"}
            </button>
          </div>
          <p className="mb-3 text-xs text-ink/50">
            The analytics/learning agents reading campaign performance and outcomes — on demand, since
            each run costs a model call. Recommendations only; nothing here changes targeting by itself.
          </p>
          {aiError && <p className="text-sm text-bad">{aiError}</p>}
          {aiInsights && (
            <div className="flex flex-col gap-3">
              {!!aiInsights.notes?.length && (
                <p className="rounded-lg bg-ink/5 px-3 py-2 text-xs text-ink/60">
                  {aiInsights.notes.join(" · ")}
                </p>
              )}
              {aiInsights.insights.summary && (
                <p className="text-sm text-ink/80">{aiInsights.insights.summary}</p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {!!aiInsights.insights.bestCampaigns?.length && (
                  <div className="rounded-lg border border-[var(--line)] p-3">
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-good">Working</div>
                    <ul className="space-y-1 text-xs text-ink/75">
                      {aiInsights.insights.bestCampaigns.map((c, i) => (
                        <li key={i}>
                          <strong>{c.name}</strong> — {c.why}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {!!aiInsights.insights.underperforming?.length && (
                  <div className="rounded-lg border border-[var(--line)] p-3">
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-gold">Underperforming</div>
                    <ul className="space-y-1 text-xs text-ink/75">
                      {aiInsights.insights.underperforming.map((c, i) => (
                        <li key={i}>
                          <strong>{c.name}</strong> — {c.why}. {c.suggestedFix}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              {!!aiInsights.recommendations.messagingRecommendations?.length && (
                <div className="rounded-lg border border-[var(--line)] p-3">
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-ink/50">
                    Messaging recommendations
                  </div>
                  <ul className="space-y-1 text-xs text-ink/75">
                    {aiInsights.recommendations.messagingRecommendations.map((r, i) => (
                      <li key={i}>
                        {r.change} <span className="text-ink/40">({r.confidence} confidence — {r.evidence})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {aiInsights.recommendations.sampleSizeWarning && (
                <p className="text-xs text-ink/45">{aiInsights.recommendations.sampleSizeWarning}</p>
              )}
              {!!aiInsights.emailImprovements?.length && (
                <div className="rounded-lg border border-[var(--line)] p-3">
                  <div className="mb-2 text-[10px] uppercase tracking-wide text-ink/50">
                    Email improvements — from comparing opened-but-unanswered emails against replied ones
                  </div>
                  <ul className="flex flex-col gap-2">
                    {aiInsights.emailImprovements.map((imp, i) => (
                      <li key={i} className="text-xs text-ink/75">
                        <strong className="text-ink/90">{imp.title}</strong>
                        <p className="mt-0.5 text-ink/60">{imp.observation}</p>
                        <p className="mt-0.5">
                          <span className="text-accent">Try:</span> {imp.suggestion}
                        </p>
                        <p className="mt-0.5 text-ink/40">Evidence: {imp.evidence}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {aiInsights.generatedAt && (
                <p className="text-[11px] text-ink/40">Last run {timeAgo(aiInsights.generatedAt)}.</p>
              )}
            </div>
          )}
        </section>

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
          title="Daily emails sent"
          subtitle={`Emails sent per day over the last ${trends.days} days (UTC).`}
          chart={
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trends.points} margin={{ top: 16, right: 8, left: 0, bottom: 8 }}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="date" {...AXIS_PROPS} minTickGap={24} tickFormatter={(d: string) => d.slice(5)} />
                  <YAxis allowDecimals={false} width={44} {...AXIS_PROPS} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Bar dataKey="emailsSent" name="Emails sent" fill={SINGLE_SERIES} radius={[4, 4, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          }
          table={
            <DataTable<CohortTrendPoint>
              rows={[...trends.points].reverse()}
              rowKey={(r) => r.date}
              columns={[
                { key: "date", header: "Date", render: (r) => r.date },
                { key: "emailsSent", header: "Emails sent", numeric: true, render: (r) => r.emailsSent },
              ]}
            />
          }
        />

        <section className="rounded-xl border border-[var(--line)] p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">Opened / Replied emails</h2>
              <p className="mt-0.5 text-xs text-ink/50">
                Every individual message that was opened or replied to, newest first.
              </p>
            </div>
            <div className="flex rounded-lg border border-[var(--line)] p-0.5">
              {(["OPENED", "REPLIED"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setEmailTab(t)}
                  aria-pressed={emailTab === t}
                  className={`rounded-md px-3 py-1 text-xs transition-colors ${
                    emailTab === t ? "bg-ink/10 font-medium text-ink" : "text-ink/60 hover:bg-ink/5"
                  }`}
                >
                  {t === "OPENED" ? "Opened" : "Replied"}
                </button>
              ))}
            </div>
          </div>
          {emailListError && <p className="text-sm text-bad">{emailListError}</p>}
          {emailListLoading ? (
            <p className="py-8 text-center text-sm text-ink/50">Loading…</p>
          ) : !emailList || emailList.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink/50">
              No emails {emailTab === "OPENED" ? "opened" : "replied to"} yet.
            </p>
          ) : (
            <DataTable<EmailListItem>
              rows={emailList}
              rowKey={(r) => r.id}
              columns={[
                {
                  key: "company",
                  header: "Company",
                  render: (r) => (
                    <a href={`/leads/${r.leadId}`} className="hover:underline">
                      {r.companyName}
                    </a>
                  ),
                },
                { key: "contact", header: "Contact", render: (r) => r.contactName ?? "—" },
                { key: "subject", header: "Subject", render: (r) => r.subject },
                { key: "step", header: "Step", numeric: true, render: (r) => r.sequenceStep },
                {
                  key: "sentAt",
                  header: "Sent",
                  render: (r) => (r.sentAt ? new Date(r.sentAt).toLocaleString() : "—"),
                },
                {
                  key: "eventAt",
                  header: emailTab === "OPENED" ? "Opened" : "Replied",
                  render: (r) => new Date(r.eventAt).toLocaleString(),
                },
              ]}
            />
          )}
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
