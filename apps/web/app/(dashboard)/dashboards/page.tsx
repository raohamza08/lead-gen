"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api-client";
import { DashboardCenterShell, useDashboardDateRange } from "../../../components/dashboard-center/dashboard-shell";
import { dashboardRangeToQuery } from "../../../components/dashboard-center/date-range-bar";
import { num, pct, money } from "../../../components/dashboard-center/format";
import { SectionCard, StatTile } from "../../../components/chart-kit";
import { ErrorState } from "../../../components/ui/error-state";
import { SkeletonCard } from "../../../components/ui/skeleton";

interface OverviewSummary {
  leads: { total: number; newLeads: number; newLeadsDeltaPct: number | null; conversionRate?: number };
  email: { sent: number; openRate: number; replyRate: number; bounced: number };
  social: { totalConversations: number; responseRate?: number };
  upwork: { totalBids: number; clientsWon: number; conversionRate?: number; connectCostAvailable: boolean; connectCost?: number };
  pipeline: { total: number; won: number; lost: number; conversionRate?: number };
  team: { activeMembers: number };
  metaAds: { connected: boolean; accountCount: number; spend?: number; leads?: number };
}

function deltaHint(pctVal: number | null | undefined): string | undefined {
  if (pctVal === null || pctVal === undefined) return undefined;
  return `${pctVal > 0 ? "↑" : "↓"} ${Math.abs(pctVal).toFixed(1)}% vs previous period`;
}

/**
 * Executive Overview — the one Dashboard Center page that reads across every
 * module at once (Part: Dashboard Center, 2026-09-30). Every number here is
 * fetched from its own module's already-built dashboard endpoint via
 * OverviewDashboardService, not recomputed — this page can never disagree
 * with what /dashboards/leads, /email, etc. report for the same range.
 */
export default function ExecutiveDashboardPage() {
  const [dateRange, setDateRange] = useDashboardDateRange();
  const query = dashboardRangeToQuery(dateRange);

  const summaryQuery = useQuery({
    queryKey: ["dc-overview", query],
    queryFn: () => api.getDashboardOverview(query) as Promise<OverviewSummary>,
  });
  const s = summaryQuery.data;

  return (
    <DashboardCenterShell
      title="Overview / Executive Dashboard"
      subtitle="Management-level KPIs and channel performance across every module, each pulled from that module's own dashboard endpoint."
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      onRefresh={() => summaryQuery.refetch()}
    >
      {summaryQuery.isLoading && <SkeletonCard className="h-64" />}
      {summaryQuery.error && <ErrorState message={(summaryQuery.error as Error).message} onRetry={() => summaryQuery.refetch()} />}

      {s && (
        <>
          <SectionCard title="Leads">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Total Leads" value={num(s.leads.total)} />
              <StatTile label="New This Period" value={num(s.leads.newLeads)} hint={deltaHint(s.leads.newLeadsDeltaPct)} />
              <StatTile label="Conversion Rate" value={pct(s.leads.conversionRate)} />
              <StatTile label="Active in Pipeline" value={num(s.pipeline.total)} />
            </div>
          </SectionCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Email">
              <div className="grid grid-cols-2 gap-3">
                <StatTile label="Sent" value={num(s.email.sent)} />
                <StatTile label="Open Rate" value={pct(s.email.openRate)} />
                <StatTile label="Reply Rate" value={pct(s.email.replyRate)} />
                <StatTile label="Bounced" value={num(s.email.bounced)} tone="bad" />
              </div>
            </SectionCard>

            <SectionCard title="Social Inbox">
              <div className="grid grid-cols-2 gap-3">
                <StatTile label="Conversations" value={num(s.social.totalConversations)} />
                <StatTile label="Response Rate" value={pct(s.social.responseRate)} />
              </div>
            </SectionCard>

            <SectionCard title="Upwork">
              <div className="grid grid-cols-2 gap-3">
                <StatTile label="Total Bids" value={num(s.upwork.totalBids)} />
                <StatTile label="Clients Won" value={num(s.upwork.clientsWon)} tone="good" />
                <StatTile label="Conversion Rate" value={pct(s.upwork.conversionRate)} />
                <StatTile
                  label="Connect Cost"
                  value={s.upwork.connectCostAvailable ? money(s.upwork.connectCost) : "Unavailable"}
                  hint={!s.upwork.connectCostAvailable ? "No connect purchases on record" : undefined}
                />
              </div>
            </SectionCard>

            <SectionCard title="Meta Ads">
              {s.metaAds.connected ? (
                <div className="grid grid-cols-2 gap-3">
                  <StatTile label="Spend" value={money(s.metaAds.spend)} />
                  <StatTile label="Leads" value={num(s.metaAds.leads)} />
                  <StatTile label="Connected Accounts" value={num(s.metaAds.accountCount)} />
                </div>
              ) : (
                <p className="py-4 text-center text-xs text-ink/45">
                  No Meta Ads account connected. <a href="/settings/meta-ads" className="text-accent hover:underline">Connect one</a> to see spend and lead data here.
                </p>
              )}
            </SectionCard>
          </div>

          <SectionCard title="Pipeline & Team">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Won" value={num(s.pipeline.won)} tone="good" />
              <StatTile label="Lost" value={num(s.pipeline.lost)} tone="bad" />
              <StatTile label="Pipeline Conv. Rate" value={pct(s.pipeline.conversionRate)} />
              <StatTile label="Active Team Members" value={num(s.team.activeMembers)} />
            </div>
          </SectionCard>
        </>
      )}
    </DashboardCenterShell>
  );
}
