"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../../../lib/api-client";
import {
  AXIS_PROPS,
  GRID_PROPS,
  SINGLE_SERIES,
  TOOLTIP_STYLE,
  formatCompact,
} from "../../../components/chart-kit";
import { PipelineStage } from "@leadgen/types";
import type { AnalyticsSummary, CohortTrendsReport, FunnelStageCount } from "@leadgen/types";

interface AgentHealth {
  totalRuns: number;
  totalFailures: number;
  agents: { agent: string; failureRate: number }[];
}

const stageLabel = (s: string) =>
  s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

/**
 * Executive dashboard.
 *
 * Leads with one hero number and a 30-day trend, because the first question is
 * "is this working and is it getting better" — a grid of equal-weight tiles
 * answers neither, since nothing tells you where to look first.
 */
export default function OverviewPage() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [funnel, setFunnel] = useState<FunnelStageCount[]>([]);
  const [trends, setTrends] = useState<CohortTrendsReport | null>(null);
  const [agents, setAgents] = useState<AgentHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.getSummary(),
      api.getFunnel(),
      api.getCohortTrends(30),
      // Agent health is supplementary: if it fails the dashboard still works,
      // so it must not be able to blank the whole page.
      api.getAgentHealth(24).catch(() => null),
    ])
      .then(([s, f, t, a]) => {
        setSummary(s as AnalyticsSummary);
        setFunnel(f as FunnelStageCount[]);
        setTrends(t as CohortTrendsReport);
        setAgents(a as AgentHealth | null);
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  if (error) {
    return (
      <div className="card border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] p-4 text-sm text-bad">
        {error}
      </div>
    );
  }
  if (!summary) {
    return (
      <div className="flex flex-col gap-4">
        {/* Skeleton matches the real layout so nothing shifts when data lands. */}
        <div className="card h-32 animate-pulse" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="card h-20 animate-pulse" />)}
        </div>
      </div>
    );
  }

  // Only stages with leads in them — rendering 20 columns where 18 are zero
  // buries the two that matter.
  const activeFunnel = funnel.filter((f) => f.count > 0).map((f) => ({ ...f, label: stageLabel(f.stage) }));
  const points = trends?.points ?? [];
  const last7 = points.slice(-7).reduce((n, p) => n + p.leadsCreated, 0);
  const prev7 = points.slice(-14, -7).reduce((n, p) => n + p.leadsCreated, 0);
  const delta = prev7 > 0 ? Math.round(((last7 - prev7) / prev7) * 100) : null;

  const inPipeline = funnel
    .filter((f) => ![PipelineStage.WON, PipelineStage.LOST, PipelineStage.CLIENT_ONBOARDING].includes(f.stage as PipelineStage))
    .reduce((n, f) => n + f.count, 0);

  const health = agents?.totalRuns
    ? Math.round((1 - agents.totalFailures / agents.totalRuns) * 100)
    : null;

  const KPIS = [
    { label: "Verified", value: summary.verifiedLeads, href: "/leads" },
    { label: "In pipeline", value: inPipeline, href: "/pipeline" },
    { label: "Awaiting verification", value: summary.awaitingVerification, href: "/pipeline", warn: summary.awaitingVerification > 0 },
    { label: "Meetings", value: summary.meetingsBooked, good: summary.meetingsBooked > 0 },
    { label: "Won", value: summary.wonDeals, good: summary.wonDeals > 0 },
    { label: "Avg lead score", value: summary.avgLeadScore },
    { label: "Duplicate rate", value: `${summary.duplicateRate}%` },
    { label: "System errors", value: summary.systemErrors, bad: summary.systemErrors > 0, href: "/automation" },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Hero: one number, with its own trend beneath it. */}
      <section className="card overflow-hidden">
        <div className="grid gap-0 md:grid-cols-[minmax(0,320px)_1fr]">
          <div className="border-b border-[var(--line)] p-6 md:border-b-0 md:border-r">
            <div className="text-[11px] uppercase tracking-wide text-ink/55">Leads this month</div>
            <div className="mt-1 flex items-end gap-3">
              <span className="text-5xl font-semibold tracking-tight">{summary.monthlyLeads}</span>
              {delta !== null && (
                <span
                  className={`mb-1.5 text-sm font-medium ${delta >= 0 ? "text-good" : "text-bad"}`}
                  title="Last 7 days vs the 7 before"
                >
                  {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}%
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-ink/45">
              {summary.todaysLeads} today · {summary.weeklyLeads} this week
              {delta !== null && " · vs previous 7 days"}
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/leads" className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90">
                Review leads
              </Link>
              <Link href="/settings" className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-ink/70 transition-colors hover:bg-ink/5">
                Run extraction
              </Link>
            </div>
          </div>

          <div className="p-4">
            <div className="mb-1 px-2 text-[11px] uppercase tracking-wide text-ink/55">
              Daily leads — last 30 days
            </div>
            <div className="h-[168px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="leadFill" x1="0" y1="0" x2="0" y2="1">
                      {/* ~10% wash, never a saturated block. */}
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="date" {...AXIS_PROPS} minTickGap={32} tickFormatter={(d: string) => d.slice(5)} />
                  <YAxis allowDecimals={false} width={32} {...AXIS_PROPS} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Area
                    type="monotone"
                    dataKey="leadsCreated"
                    name="Leads"
                    stroke={SINGLE_SERIES}
                    strokeWidth={2}
                    fill="url(#leadFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {KPIS.map((k) => {
          const tone = k.bad ? "text-bad" : k.warn ? "text-gold" : k.good ? "text-good" : "text-ink";
          const body = (
            <>
              <div className="text-[11px] uppercase tracking-wide text-ink/55">{k.label}</div>
              <div className={`mt-1 text-2xl font-semibold tracking-tight ${tone}`}>{k.value}</div>
            </>
          );
          return k.href ? (
            <Link key={k.label} href={k.href} className="card card-interactive px-4 py-3.5">{body}</Link>
          ) : (
            <div key={k.label} className="card px-4 py-3.5">{body}</div>
          );
        })}
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <section className="card p-5">
          <h2 className="text-sm font-semibold tracking-tight">Pipeline funnel</h2>
          <p className="mb-4 mt-0.5 text-xs text-ink/50">
            Stages with at least one lead. Empty stages are hidden so the active ones stay readable.
          </p>
          {activeFunnel.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink/45">
              No leads in the pipeline yet.{" "}
              <Link href="/settings" className="text-accent hover:underline">Configure a niche filter</Link> to start.
            </p>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={activeFunnel} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                  <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
                  <XAxis type="number" allowDecimals={false} {...AXIS_PROPS} />
                  <YAxis type="category" dataKey="label" width={130} {...AXIS_PROPS} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Bar dataKey="count" fill={SINGLE_SERIES} radius={[0, 4, 4, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-semibold tracking-tight">Automation health</h2>
          <p className="mb-4 mt-0.5 text-xs text-ink/50">Agent runs, last 24 hours.</p>

          {!agents || agents.totalRuns === 0 ? (
            <p className="py-6 text-center text-xs text-ink/45">No agent activity in the last 24h.</p>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className={`text-3xl font-semibold tracking-tight ${
                  health! >= 95 ? "text-good" : health! >= 80 ? "text-gold" : "text-bad"
                }`}>
                  {health}%
                </span>
                <span className="text-xs text-ink/50">success rate</span>
              </div>
              <div className="mt-1 text-xs text-ink/45">
                {agents.totalRuns} runs · {agents.totalFailures} failed
              </div>

              <ul className="mt-4 space-y-1.5 border-t border-[var(--line)] pt-3">
                {agents.agents.slice(0, 5).map((a) => (
                  <li key={a.agent} className="flex items-center justify-between text-xs">
                    <span className="truncate text-ink/70">{a.agent}</span>
                    <span className={a.failureRate > 20 ? "text-bad" : a.failureRate > 5 ? "text-gold" : "text-ink/45"}>
                      {a.failureRate}%
                    </span>
                  </li>
                ))}
              </ul>
              <Link href="/automation" className="mt-3 inline-block text-xs text-accent hover:underline">
                View all agents →
              </Link>
            </>
          )}
        </section>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Today", summary.todaysLeads],
          ["This week", summary.weeklyLeads],
          ["Tasks waiting", summary.tasksWaiting],
          ["Avg AI opportunity", summary.avgAiOpportunityScore],
        ].map(([label, value]) => (
          <div key={label as string} className="card px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-ink/55">{label}</div>
            <div className="mt-0.5 text-lg font-semibold">{formatCompact(Number(value))}</div>
          </div>
        ))}
      </section>

      <LeadRoomOverviewSection />
      <EmailOverviewSection />
      <SocialMediaOverviewSection />
    </div>
  );
}

interface SourceBreakdown {
  total: number;
  bySource: Record<string, number>;
  scored: number;
  awaitingResearch: number;
}

const SOURCE_DISPLAY: Record<string, string> = {
  SURFACE_WEB: "Surface web",
  LICENSED_DATABASE: "Licensed database",
  MANUAL: "Manual",
  EMAIL: "Email",
  SOCIAL_MEDIA: "Social",
};

/** Lead Room card (Part: Lead Room) — these tiles (captured/awaiting
 *  research/scored) are lead-level facts, not pipeline-stage-derived, so
 *  they're unaffected by whether a lead has been promoted to the Pipeline
 *  yet (see LeadsService.promoteToPipeline) — this is every captured lead
 *  regardless of promotion status, same data the hero above already
 *  summarizes from a different angle. */
function LeadRoomOverviewSection() {
  const [breakdown, setBreakdown] = useState<SourceBreakdown | null>(null);

  useEffect(() => {
    api.getLeadSourceBreakdown().then((b) => setBreakdown(b as SourceBreakdown)).catch(() => {});
  }, []);

  if (!breakdown || breakdown.total === 0) return null;

  const tiles: { label: string; value: number; href: string }[] = [
    { label: "Total captured", value: breakdown.total, href: "/leads" },
    { label: "Awaiting research", value: breakdown.awaitingResearch, href: "/leads" },
    { label: "Scored", value: breakdown.scored, href: "/leads" },
  ];

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold tracking-tight">Lead Room</h2>
      <p className="mb-4 mt-0.5 text-xs text-ink/50">
        Every lead captured so far, from every source. Human-added leads (manual, email, social) wait
        here until you promote them to the Pipeline; AI-discovered leads advance automatically.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="card card-interactive px-4 py-3.5">
            <div className="text-[11px] uppercase tracking-wide text-ink/55">{t.label}</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight">{t.value}</div>
          </Link>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--line)] pt-3">
        {Object.entries(breakdown.bySource)
          .filter(([, count]) => count > 0)
          .map(([source, count]) => (
            <span key={source} className="rounded-full bg-ink/8 px-2.5 py-1 text-xs text-ink/60">
              {SOURCE_DISPLAY[source] ?? source}: {count}
            </span>
          ))}
      </div>
    </section>
  );
}

interface SocialStats {
  connectedAccounts: number;
  draft: number;
  pendingReview: number;
  scheduled: number;
  published: number;
  failed: number;
}

/** Social Media card — same shape as EmailOverviewSection below, so every
 *  module the Dashboard covers reads the same way. */
function SocialMediaOverviewSection() {
  const [stats, setStats] = useState<SocialStats | null>(null);

  useEffect(() => {
    api.getSocialStats().then((s) => setStats(s as SocialStats)).catch(() => {});
  }, []);

  if (!stats || stats.connectedAccounts === 0) return null;

  const tiles: { label: string; value: number; href: string; warn?: boolean }[] = [
    { label: "Connected accounts", value: stats.connectedAccounts, href: "/social-media/accounts" },
    { label: "Pending review", value: stats.pendingReview, href: "/social-media/posts", warn: stats.pendingReview > 0 },
    { label: "Scheduled", value: stats.scheduled, href: "/social-media/calendar" },
    { label: "Published", value: stats.published, href: "/social-media/posts" },
    { label: "Drafts", value: stats.draft, href: "/social-media/posts" },
    { label: "Failed", value: stats.failed, href: "/social-media/posts", warn: stats.failed > 0 },
  ];

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold tracking-tight">Social Media</h2>
      <p className="mb-4 mt-0.5 text-xs text-ink/50">Across every connected account you have access to.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className={`card card-interactive px-4 py-3.5 ${t.warn ? "text-gold" : ""}`}
          >
            <div className="text-[11px] uppercase tracking-wide text-ink/55">{t.label}</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight">{t.value}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}

interface EmailHubStats {
  connectedAccounts: number;
  unread: number;
  important: number;
  receivedToday: number;
  receivedThisWeek: number;
  leadsFromEmail: number;
  ignored: number;
}

/** Dashboard Statistics (Part 15) — every number here is a `Link` straight
 *  into the matching filtered Email Hub view, per the spec's explicit
 *  "should be clickable" requirement, not just a static count. */
function EmailOverviewSection() {
  const [stats, setStats] = useState<EmailHubStats | null>(null);

  useEffect(() => {
    api.getEmailHubStats().then((s) => setStats(s as EmailHubStats)).catch(() => {});
  }, []);

  if (!stats || stats.connectedAccounts === 0) return null;

  const tiles: { label: string; value: number; href: string }[] = [
    { label: "Connected accounts", value: stats.connectedAccounts, href: "/settings#email-hub-accounts" },
    { label: "Unread", value: stats.unread, href: "/email-hub" },
    { label: "Important", value: stats.important, href: "/email-hub?view=important" },
    { label: "Potential leads", value: stats.leadsFromEmail, href: "/email-hub?view=leads" },
    { label: "Received today", value: stats.receivedToday, href: "/email-hub" },
    { label: "Ignored", value: stats.ignored, href: "/email-hub?view=ignored" },
  ];

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold tracking-tight">Email Overview</h2>
      <p className="mb-4 mt-0.5 text-xs text-ink/50">Across every mailbox you have access to.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="card card-interactive px-4 py-3.5">
            <div className="text-[11px] uppercase tracking-wide text-ink/55">{t.label}</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight">{t.value}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
