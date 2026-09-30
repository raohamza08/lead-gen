"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { DashboardCenterShell, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";
import { dashboardRangeToQuery } from "../../../../components/dashboard-center/date-range-bar";
import { num, pct, money } from "../../../../components/dashboard-center/format";
import { ComparisonHint } from "../../../../components/dashboard-center/metric-detail";
import { SectionCard, StatTile } from "../../../../components/chart-kit";
import { ErrorState } from "../../../../components/ui/error-state";
import { SkeletonCard } from "../../../../components/ui/skeleton";

interface OverviewSummary {
  leads: { total: number; newLeads: number; previousTotalLeads?: number; newLeadsDeltaPct: number | null; conversionRate?: number };
  email: { sent: number; openRate: number; replyRate: number; bounced: number };
  social: { totalConversations: number; responseRate?: number };
  upwork: { totalBids: number; clientsWon: number; conversionRate?: number; connectCostBasis: "actual_purchases" | "flat_rate_estimate"; connectCost?: number };
  pipeline: { total: number; won: number; lost: number; conversionRate?: number };
  team: { activeMembers: number };
  metaAds: { connected: boolean; accountCount: number; spend?: number; leads?: number; currency?: string; mixedCurrencies?: boolean };
}

/** Every Overview tile is a rollup already broken down in full on its own
 *  dashboard tab — the drill-down here jumps to that tab rather than
 *  duplicating the breakdown (Part: Dashboard Center, 2026-09-30). */
function SeeFullDashboard({ tab, label }: { tab: string; label: string }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-ink/70">This is a rollup computed the same way as the full {label} dashboard.</p>
      <a href={`/dashboards?tab=${tab}`} className="text-sm text-accent hover:underline">
        Open {label} dashboard →
      </a>
    </div>
  );
}

/**
 * Executive Overview — the one Dashboard Center tab that reads across every
 * module at once (Part: Dashboard Center, 2026-09-30). Every number here is
 * fetched from its own module's already-built dashboard endpoint via
 * OverviewDashboardService, not recomputed — this tab can never disagree
 * with what the Leads/Email/etc. tabs report for the same range.
 */
export function OverviewTab() {
  const [dateRange, setDateRange] = useDashboardDateRange();
  const query = dashboardRangeToQuery(dateRange);

  const summaryQuery = useQuery({
    queryKey: ["dc-overview", query],
    queryFn: () => api.getDashboardOverview(query) as Promise<OverviewSummary>,
  });
  const s = summaryQuery.data;

  return (
    <DashboardCenterShell
      compact
      title="Overview / Executive Dashboard"
      subtitle="Management-level KPIs and channel performance across every module, each pulled from that module's own dashboard endpoint."
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      onRefresh={() => summaryQuery.refetch()}
      refreshing={summaryQuery.isFetching}
    >
      {summaryQuery.isLoading && <SkeletonCard className="h-64" />}
      {summaryQuery.error && <ErrorState message={(summaryQuery.error as Error).message} onRetry={() => summaryQuery.refetch()} />}

      {s && (
        <>
          <SectionCard title="Leads" expandable>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Total Leads" value={num(s.leads.total)} detail={<SeeFullDashboard tab="leads" label="Leads" />} />
              <StatTile
                label="New This Period"
                value={num(s.leads.newLeads)}
                hint={<ComparisonHint deltaPct={s.leads.newLeadsDeltaPct} previousValue={s.leads.previousTotalLeads !== undefined ? num(s.leads.previousTotalLeads) : undefined} />}
                detail={<SeeFullDashboard tab="leads" label="Leads" />}
              />
              <StatTile label="Conversion Rate" value={pct(s.leads.conversionRate)} detail={<SeeFullDashboard tab="leads" label="Leads" />} />
              <StatTile label="Active in Pipeline" value={num(s.pipeline.total)} detail={<SeeFullDashboard tab="pipeline" label="Pipeline" />} />
            </div>
          </SectionCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Email" expandable>
              <div className="grid grid-cols-2 gap-3">
                <StatTile label="Sent" value={num(s.email.sent)} detail={<SeeFullDashboard tab="email" label="Email Campaign" />} />
                <StatTile label="Open Rate" value={pct(s.email.openRate)} detail={<SeeFullDashboard tab="email" label="Email Campaign" />} />
                <StatTile label="Reply Rate" value={pct(s.email.replyRate)} detail={<SeeFullDashboard tab="email" label="Email Campaign" />} />
                <StatTile label="Bounced" value={num(s.email.bounced)} tone="bad" detail={<SeeFullDashboard tab="email" label="Email Campaign" />} />
              </div>
            </SectionCard>

            <SectionCard title="Social Inbox" expandable>
              <div className="grid grid-cols-2 gap-3">
                <StatTile label="Conversations" value={num(s.social.totalConversations)} detail={<SeeFullDashboard tab="social" label="Social Inbox" />} />
                <StatTile label="Response Rate" value={pct(s.social.responseRate)} detail={<SeeFullDashboard tab="social" label="Social Inbox" />} />
              </div>
            </SectionCard>

            <SectionCard title="Upwork" expandable>
              <div className="grid grid-cols-2 gap-3">
                <StatTile label="Total Bids" value={num(s.upwork.totalBids)} detail={<SeeFullDashboard tab="upwork" label="Upwork" />} />
                <StatTile label="Clients Won" value={num(s.upwork.clientsWon)} tone="good" detail={<SeeFullDashboard tab="upwork" label="Upwork" />} />
                <StatTile label="Conversion Rate" value={pct(s.upwork.conversionRate)} detail={<SeeFullDashboard tab="upwork" label="Upwork" />} />
                <StatTile
                  label="Connect Cost"
                  value={money(s.upwork.connectCost)}
                  hint={s.upwork.connectCostBasis === "flat_rate_estimate" ? "Estimated at $0.15/connect" : undefined}
                  detail={<SeeFullDashboard tab="upwork" label="Upwork" />}
                />
              </div>
            </SectionCard>

            <SectionCard title="Meta Ads" expandable>
              {s.metaAds.connected ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <StatTile
                      label="Spend"
                      value={s.metaAds.mixedCurrencies ? "Mixed currencies" : money(s.metaAds.spend, s.metaAds.currency)}
                      hint={s.metaAds.mixedCurrencies ? "Connected accounts bill in different currencies — see the Meta Ads tab per account" : undefined}
                      detail={<SeeFullDashboard tab="meta-ads" label="Meta Ads" />}
                    />
                    <StatTile label="Leads" value={num(s.metaAds.leads)} detail={<SeeFullDashboard tab="meta-ads" label="Meta Ads" />} />
                    <StatTile label="Connected Accounts" value={num(s.metaAds.accountCount)} detail={<SeeFullDashboard tab="meta-ads" label="Meta Ads" />} />
                  </div>
                </>
              ) : (
                <p className="py-4 text-center text-xs text-ink/45">
                  No Meta Ads account connected. <a href="/settings/meta-ads" className="text-accent hover:underline">Connect one</a> to see spend and lead data here.
                </p>
              )}
            </SectionCard>
          </div>

          <SectionCard title="Pipeline & Team" expandable>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Won" value={num(s.pipeline.won)} tone="good" detail={<SeeFullDashboard tab="pipeline" label="Pipeline" />} />
              <StatTile label="Lost" value={num(s.pipeline.lost)} tone="bad" detail={<SeeFullDashboard tab="pipeline" label="Pipeline" />} />
              <StatTile label="Pipeline Conv. Rate" value={pct(s.pipeline.conversionRate)} detail={<SeeFullDashboard tab="pipeline" label="Pipeline" />} />
              <StatTile label="Active Team Members" value={num(s.team.activeMembers)} detail={<SeeFullDashboard tab="team" label="Team Performance" />} />
            </div>
          </SectionCard>
        </>
      )}
    </DashboardCenterShell>
  );
}
