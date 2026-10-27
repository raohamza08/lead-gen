"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../../../lib/api-client";
import { DashboardCenterShell, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";
import { dashboardRangeToQuery } from "../../../../components/dashboard-center/date-range-bar";
import { num, money, dateTime } from "../../../../components/dashboard-center/format";
import { AXIS_PROPS, DataTable, DonutBreakdown, GRID_PROPS, KpiStrip, Legend, SectionCard, SERIES, StatTile, TOOLTIP_STYLE } from "../../../../components/chart-kit";
import { ErrorState } from "../../../../components/ui/error-state";
import { SkeletonCard } from "../../../../components/ui/skeleton";
import { EmptyState } from "../../../../components/ui/empty-state";

type DetailedCategory = "BIDDING" | "INVITE" | "OPEN_FOR_WORK" | "PROPOSAL_BOOST" | "PURCHASE" | "AWARD" | "OTHER";

interface CategoryRow {
  category: DetailedCategory;
  label: string;
  kind: "SPEND" | "CREDIT";
  connects: number;
  transactionCount: number;
  estimatedCost: number;
}

interface ConnectsOverview {
  range: { from: string; to: string };
  balance: { connectsBalance: number; rolloverBalance: number; connectsBalanceFree: number; connectsBalancePaid: number; capturedAt: string } | null;
  connectUnitCost: number;
  totalSpend: number;
  totalSpendCost: number;
  totalAdded: number;
  categories: CategoryRow[];
}

interface DailyTrendPoint {
  day: string;
  bidding: number;
  invite: number;
  openForWork: number;
  other: number;
}

interface ConnectsTransaction {
  id: string;
  occurredAt: string;
  transactionType: string;
  reason: string | null;
  category: DetailedCategory;
  amountDisplay: string;
  jobId: string | null;
  jobTitle: string | null;
}

interface SubmitterRow {
  name: string;
  profileName: string;
  bids: number;
  connects: number;
  won: number;
  lost: number;
}

interface ProfileRow {
  profileName: string;
  bids: number;
  connects: number;
  won: number;
  lost: number;
}

const CATEGORY_COLOR: Record<DetailedCategory, string> = {
  BIDDING: SERIES[0],
  INVITE: SERIES[2],
  OPEN_FOR_WORK: SERIES[3],
  PROPOSAL_BOOST: SERIES[1],
  PURCHASE: "rgb(var(--good-rgb))",
  AWARD: "rgb(var(--good-rgb))",
  OTHER: "var(--ink-muted)",
};

/** Connects Dashboard (Part: Connects Dashboard, 2026-10-28, explicit user
 *  request: "create a connects dashboard in which we show each and every
 *  connect usage, like how much gets spent on bidding, on which profile how
 *  many bids, how many connects, how many connects on invites, how many on
 *  open for work and etc"). The detailed drill-down underneath the Upwork
 *  tab's Bidding/Invites Stats cards -- every category the real Connects
 *  ledger actually contains, not just the two those cards focus on.
 *
 *  Per-profile breakdown reuses the Upwork tab's own /upwork/submitters
 *  data, re-grouped by profile alone (see ProfileRow aggregation below) --
 *  Upwork's Connects API never attaches a profile to a transaction
 *  (confirmed empirically), so a true per-profile connects figure can only
 *  come from the manually-logged UpworkProposal.connects field, same
 *  source that page already uses. Not re-fetched separately; same query
 *  key would just duplicate the network request react-query already
 *  dedupes if both tabs are visited in the same session anyway. */
export function ConnectsTab() {
  const [dateRange, setDateRange] = useDashboardDateRange();
  const query = dashboardRangeToQuery(dateRange);

  const overviewQuery = useQuery({
    queryKey: ["dc-connects-overview", query],
    queryFn: () => api.getDashboardConnectsOverview(query) as Promise<ConnectsOverview>,
  });
  const trendQuery = useQuery({
    queryKey: ["dc-connects-daily-trend", query],
    queryFn: () => api.getDashboardConnectsDailyTrend(query) as Promise<DailyTrendPoint[]>,
  });
  const transactionsQuery = useQuery({
    queryKey: ["dc-connects-transactions", query],
    queryFn: () => api.getDashboardConnectsTransactions(query) as Promise<ConnectsTransaction[]>,
  });
  const submittersQuery = useQuery({
    queryKey: ["dc-upwork-submitters", query],
    queryFn: () => api.getDashboardUpworkSubmitters(query) as Promise<SubmitterRow[]>,
  });

  const overview = overviewQuery.data;
  const trend = trendQuery.data ?? [];
  const transactions = transactionsQuery.data ?? [];

  // Re-group the submitter-level rows down to profile-only (Part: Connects
  // Dashboard -- "on which profile how many bids, how many connects").
  // Several submitters can share one profile, so this sums across them
  // rather than assuming a 1:1 submitter-to-profile mapping.
  const profiles: ProfileRow[] = useMemo(() => {
    const byProfile = new Map<string, ProfileRow>();
    for (const r of submittersQuery.data ?? []) {
      const row = byProfile.get(r.profileName) ?? { profileName: r.profileName, bids: 0, connects: 0, won: 0, lost: 0 };
      row.bids += r.bids;
      row.connects += r.connects;
      row.won += r.won;
      row.lost += r.lost;
      byProfile.set(r.profileName, row);
    }
    return [...byProfile.values()].sort((a, b) => b.connects - a.connects);
  }, [submittersQuery.data]);

  const spendCategories = overview?.categories.filter((c) => c.kind === "SPEND") ?? [];
  const creditCategories = overview?.categories.filter((c) => c.kind === "CREDIT") ?? [];

  return (
    <DashboardCenterShell
      compact
      title="Connects Dashboard"
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      onRefresh={() => {
        overviewQuery.refetch();
        trendQuery.refetch();
        transactionsQuery.refetch();
        submittersQuery.refetch();
      }}
      refreshing={overviewQuery.isFetching || trendQuery.isFetching || transactionsQuery.isFetching || submittersQuery.isFetching}
    >
      {overviewQuery.isLoading && <SkeletonCard className="h-32" />}
      {overviewQuery.error && <ErrorState message={(overviewQuery.error as Error).message} onRetry={() => overviewQuery.refetch()} />}

      {overview && (
        <KpiStrip>
          {overview.balance && (
            <>
              <StatTile label="Connects Balance" value={num(overview.balance.connectsBalance)} />
              <StatTile label="Free" value={num(overview.balance.connectsBalanceFree)} />
              <StatTile label="Paid" value={num(overview.balance.connectsBalancePaid)} />
              <StatTile label="Rollover" value={num(overview.balance.rolloverBalance)} />
            </>
          )}
          <StatTile label="Total Spent (period)" value={num(overview.totalSpend)} tone="bad" />
          <StatTile label="Estimated Cost" value={money(overview.totalSpendCost)} />
          <StatTile label="Connects Purchased (period)" value={num(overview.totalAdded)} tone="good" />
          <StatTile label="Rate / Connect" value={money(overview.connectUnitCost)} />
        </KpiStrip>
      )}

      {overview && spendCategories.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard title="Where connects are spent" subtitle={`${num(overview.totalSpend)} connects this period`}>
            <DonutBreakdown
              data={spendCategories.map((c) => ({ label: c.label, value: c.connects, color: CATEGORY_COLOR[c.category] }))}
              centerValue={num(overview.totalSpend)}
              centerLabel="Total spent"
            />
          </SectionCard>

          <SectionCard title="Full category breakdown">
            {/* No showSummary here (Part: Connects Dashboard, 2026-10-28,
                user-reported confusing "Total Connects" figure) -- this
                table deliberately mixes SPEND rows (Bidding, Invites, Open
                for Work...) and CREDIT rows (Purchases, Awards) in one
                list for display, but DataTable's auto-summary just sums
                the "connects" column blindly across every row regardless
                of kind, producing a number that's spend-plus-credit added
                together -- not a real total of anything. totalSpend and
                totalAdded above the table already report each side
                correctly on their own. */}
            <DataTable
              rowKey={(r) => r.category}
              rows={overview.categories}
              columns={[
                { key: "label", header: "Category", render: (r) => r.label, sortValue: (r) => r.label },
                { key: "kind", header: "Type", render: (r) => (r.kind === "SPEND" ? "Spent" : "Added") },
                { key: "connects", header: "Connects", numeric: true, render: (r) => num(r.connects), sortValue: (r) => r.connects },
                { key: "transactionCount", header: "Transactions", numeric: true, render: (r) => num(r.transactionCount), sortValue: (r) => r.transactionCount },
                {
                  key: "estimatedCost",
                  header: "Est. Cost",
                  numeric: true,
                  render: (r) => (r.kind === "SPEND" ? money(r.estimatedCost) : "—"),
                  sortValue: (r) => (r.kind === "SPEND" ? r.estimatedCost : undefined),
                },
              ]}
            />
          </SectionCard>
        </div>
      )}

      {trendQuery.isLoading && <SkeletonCard className="h-56" />}
      {!trendQuery.isLoading && trend.length === 0 && (
        <SectionCard title="Daily spend trend">
          <EmptyState title="No connects activity in this period" />
        </SectionCard>
      )}
      {trend.length > 0 && (
        <SectionCard title="Daily spend trend" subtitle="Real per-day totals from the synced Connects ledger" expandable>
          <Legend
            items={[
              { label: "Bidding", color: CATEGORY_COLOR.BIDDING },
              { label: "Invites", color: CATEGORY_COLOR.INVITE },
              { label: "Open for Work", color: CATEGORY_COLOR.OPEN_FOR_WORK },
              { label: "Other", color: CATEGORY_COLOR.OTHER },
            ]}
          />
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={trend}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="day" {...AXIS_PROPS} />
              <YAxis {...AXIS_PROPS} allowDecimals={false} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Bar dataKey="bidding" name="Bidding" stackId="spend" fill={CATEGORY_COLOR.BIDDING} />
              <Bar dataKey="invite" name="Invites" stackId="spend" fill={CATEGORY_COLOR.INVITE} />
              <Bar dataKey="openForWork" name="Open for Work" stackId="spend" fill={CATEGORY_COLOR.OPEN_FOR_WORK} />
              <Bar dataKey="other" name="Other" stackId="spend" fill={CATEGORY_COLOR.OTHER} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      )}

      {creditCategories.length > 0 && (
        <SectionCard title="Connects added" subtitle="Purchases and Upwork-granted bonuses — not spend, shown separately">
          <KpiStrip>
            {creditCategories.map((c) => (
              <StatTile key={c.category} label={c.label} value={num(c.connects)} tone="good" />
            ))}
          </KpiStrip>
        </SectionCard>
      )}

      {submittersQuery.isLoading && <SkeletonCard className="h-32" />}
      {!submittersQuery.isLoading && profiles.length === 0 && (
        <SectionCard title="By profile" subtitle="Manually logged bids, grouped by profile">
          <EmptyState title="No bidding profiles recorded in this period" />
        </SectionCard>
      )}
      {profiles.length > 0 && (
        <SectionCard title="By profile" subtitle="Manually logged bids, grouped by profile — not from the real Connects ledger, which carries no profile attribution">
          <DataTable
            showSummary
            rowKey={(r) => r.profileName}
            rows={profiles}
            columns={[
              { key: "profileName", header: "Profile", render: (r) => r.profileName, sortValue: (r) => r.profileName },
              { key: "bids", header: "Bids", numeric: true, render: (r) => num(r.bids), sortValue: (r) => r.bids },
              { key: "connects", header: "Connects Used", numeric: true, render: (r) => num(r.connects), sortValue: (r) => r.connects },
              { key: "won", header: "Won", numeric: true, render: (r) => num(r.won), sortValue: (r) => r.won },
              { key: "lost", header: "Lost", numeric: true, render: (r) => num(r.lost), sortValue: (r) => r.lost },
            ]}
          />
        </SectionCard>
      )}

      {transactionsQuery.isLoading && <SkeletonCard className="h-32" />}
      {!transactionsQuery.isLoading && transactions.length === 0 && (
        <SectionCard title="Transactions">
          <EmptyState title="No connects transactions in this period" />
        </SectionCard>
      )}
      {transactions.length > 0 && (
        <SectionCard title="Transactions" subtitle={`${num(transactions.length)} in this period`} expandable>
          <DataTable
            rowKey={(r) => r.id}
            rows={transactions}
            columns={[
              { key: "occurredAt", header: "Date", render: (r) => dateTime(r.occurredAt), sortValue: (r) => new Date(r.occurredAt).getTime() },
              { key: "category", header: "Category", render: (r) => r.category, sortValue: (r) => r.category },
              { key: "reason", header: "Reason", render: (r) => r.reason ?? "—", sortValue: (r) => r.reason },
              { key: "amountDisplay", header: "Connects", numeric: true, render: (r) => r.amountDisplay, sortValue: (r) => Number(r.amountDisplay) },
              { key: "jobTitle", header: "Job", render: (r) => r.jobTitle ?? "—", sortValue: (r) => r.jobTitle },
            ]}
          />
        </SectionCard>
      )}
    </DashboardCenterShell>
  );
}
