"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, getCurrentUser } from "../../../../lib/api-client";
import { DashboardCenterShell, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";
import { dashboardRangeToQuery } from "../../../../components/dashboard-center/date-range-bar";
import { num, pct, money, dateTime } from "../../../../components/dashboard-center/format";
import { MetricDetail, ComparisonHint } from "../../../../components/dashboard-center/metric-detail";
import { AXIS_PROPS, ChartWithTable, DataTable, DonutBreakdown, GRID_PROPS, KpiStrip, Legend, SectionCard, SERIES, StatTile, TOOLTIP_STYLE, formatCompact } from "../../../../components/chart-kit";
import { ErrorState } from "../../../../components/ui/error-state";
import { SkeletonCard } from "../../../../components/ui/skeleton";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Input } from "../../../../components/ui/input";
import { Button } from "../../../../components/ui/button";

interface UpworkKpis {
  totalBids: number;
  previousTotalBids?: number;
  totalBidsDeltaPct: number | null;
  totalInvites: number;
  invitesAccepted: number;
  invitesRejected: number;
  clientsWon: number;
  previousClientsWon?: number;
  clientsWonDeltaPct: number | null;
  clientsLost: number;
  wonBids: number;
  wonInvites: number;
  lostBids: number;
  lostInvites: number;
  conversionRateBidding?: number;
  conversionRateInvites?: number;
  bidsViewed: number;
  bidsInDiscussion: number;
  invitesInDiscussion: number;
  connectsUsed: number;
  connectsUsedSource: "manual_entry" | "real_ledger" | "hybrid";
  connectsUsedInvites: number;
  inviteConnectCost: number;
  costPerInvite?: number;
  connectsUsedProfileBoost: number;
  profileBoostConnectCost: number;
  connectCostAvailable: boolean;
  connectCostBasis: "actual_purchases" | "flat_rate_estimate";
  connectUnitCost: number;
  connectCost?: number;
  costPerBid?: number;
  costPerClientBids?: number;
  connectsPerClient?: number;
  avgConnectsPerBid?: number;
  conversionRate?: number;
}

interface MonthlyRow {
  month: string;
  bids: number;
  invites: number;
  connectsUsed: number;
  clientsWon: number;
  connectsPurchased?: number;
  purchaseCost?: number;
  estimatedUsageCost: number;
  bidsPerClient?: number;
  connectsPerClient?: number;
}

interface UpworkRequestsSummary {
  requestedHours: number;
  biddingHours: number;
  inviteHours: number;
  totalOnboardedHours: number;
  remainingHours: number;
  pendingReview: number;
  approvedCount: number;
  rejectedCount: number;
  byProjectManager: { projectManagerId: string; name: string; requestedHours: number }[];
  // The weekly target belongs to whichever Business Developer approves a
  // request, not the requesting Project Manager (explicit user decision) —
  // this is the real performance breakdown; byProjectManager above is just
  // "who asked."
  byBusinessDeveloper: { businessDeveloperId: string; name: string; requestedHours: number; achievedHours: number }[];
  byProfile: { profileName: string; requestedHours: number; achievedHours: number }[];
}

interface SubmitterRow {
  name: string;
  profileName: string;
  bids: number;
  invites: number;
  connects: number;
  won: number;
  lost: number;
  onboardedHours: number;
  conversionRate?: number;
  connectsPerClient?: number;
  estimatedCost: number;
}

interface ConnectPurchase {
  id: string;
  purchasedAt: string;
  connectsAmount: number;
  totalCost: number;
  currency: string;
  notes: string | null;
}

const EMPTY_PURCHASE = { purchasedAt: "", connectsAmount: "", totalCost: "", currency: "USD", notes: "" };

export function UpworkTab() {
  const [dateRange, setDateRange] = useDashboardDateRange();
  const query = dashboardRangeToQuery(dateRange);
  const isAdmin = getCurrentUser()?.role === "ADMIN";
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(EMPTY_PURCHASE);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  // Caps the purchase ledger at 5 rows by default (Part: premium dark
  // theme pass v4, 2026-10-19, explicit user request — "the purchase
  // ledger in the upwork tab should be collapsed, it should only show 5
  // entries by default"), same "cap long lists, View all" convention used
  // elsewhere in the app rather than always rendering every purchase ever
  // recorded.
  const PURCHASE_PAGE_SIZE = 5;
  const [showAllPurchases, setShowAllPurchases] = useState(false);

  const kpisQuery = useQuery({ queryKey: ["dc-upwork-kpis", query], queryFn: () => api.getDashboardUpworkKpis(query) as Promise<UpworkKpis> });
  const monthlyQuery = useQuery({ queryKey: ["dc-upwork-monthly"], queryFn: () => api.getDashboardUpworkMonthly() as Promise<MonthlyRow[]> });
  const submittersQuery = useQuery({
    queryKey: ["dc-upwork-submitters", query],
    queryFn: () => api.getDashboardUpworkSubmitters(query) as Promise<SubmitterRow[]>,
  });
  const purchasesQuery = useQuery({
    queryKey: ["dc-upwork-purchases"],
    queryFn: () => api.getDashboardUpworkConnectPurchases() as Promise<ConnectPurchase[]>,
  });
  // Part: Upwork Requests, 2026-10-01 -- reuses this page's own shared date
  // range control rather than a second filter bar, per the feature's UI/UX
  // requirement to stay consistent with existing dashboard components.
  const requestsQuery = useQuery({
    queryKey: ["dc-upwork-requests-summary", query],
    queryFn: () => api.getUpworkRequestsDashboardSummary(query) as Promise<UpworkRequestsSummary>,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.createDashboardUpworkConnectPurchase({
        purchasedAt: draft.purchasedAt,
        connectsAmount: Number(draft.connectsAmount),
        totalCost: Number(draft.totalCost),
        currency: draft.currency || "USD",
        notes: draft.notes || undefined,
      }),
    onSuccess: () => {
      setDraft(EMPTY_PURCHASE);
      setShowForm(false);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["dc-upwork-purchases"] });
      queryClient.invalidateQueries({ queryKey: ["dc-upwork-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["dc-upwork-monthly"] });
    },
    onError: (err) => setError((err as Error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteDashboardUpworkConnectPurchase(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dc-upwork-purchases"] });
      queryClient.invalidateQueries({ queryKey: ["dc-upwork-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["dc-upwork-monthly"] });
    },
  });

  const [importNotice, setImportNotice] = useState<string | null>(null);
  const importMutation = useMutation({
    mutationFn: (csv: string) => api.importDashboardUpworkConnectPurchases(csv),
    onSuccess: (result) => {
      setError(null);
      const skippedNote = result.skipped.length > 0 ? ` ${result.skipped.length} row(s) skipped (see console).` : "";
      setImportNotice(
        `Imported ${result.imported} new purchase(s) from ${result.connectRowsFound} connect transaction(s) found${
          result.alreadyImported > 0 ? ` (${result.alreadyImported} already on record)` : ""
        }.${skippedNote}`,
      );
      if (result.skipped.length > 0) console.warn("Upwork connect-purchase import: skipped rows", result.skipped);
      queryClient.invalidateQueries({ queryKey: ["dc-upwork-purchases"] });
      queryClient.invalidateQueries({ queryKey: ["dc-upwork-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["dc-upwork-monthly"] });
    },
    onError: (err) => setError((err as Error).message),
  });

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setError(null);
    setImportNotice(null);
    const reader = new FileReader();
    reader.onload = () => importMutation.mutate(String(reader.result ?? ""));
    reader.onerror = () => setError("Could not read that file.");
    reader.readAsText(file);
  }

  function submitPurchase(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.purchasedAt || !draft.connectsAmount || !draft.totalCost) {
      setError("Date, connects amount, and total cost are all required.");
      return;
    }
    createMutation.mutate();
  }

  const kpis = kpisQuery.data;
  const monthly = monthlyQuery.data ?? [];
  const submitters = submittersQuery.data ?? [];
  const purchases = purchasesQuery.data ?? [];

  // This-month summary for the ledger card (Part: Dashboard Center,
  // 2026-09-30 — "after uploading the csv the summary should be there").
  // Reuses the same monthly rollup the Monthly Trend table below is built
  // from, just picked out for the current calendar month, so this can never
  // disagree with that table.
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const thisMonth = monthly.find((m) => m.month === currentMonthKey);

  return (
    <DashboardCenterShell
      compact
      title="Upwork Dashboard"
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      onRefresh={() => {
        kpisQuery.refetch();
        monthlyQuery.refetch();
        submittersQuery.refetch();
        purchasesQuery.refetch();
        requestsQuery.refetch();
      }}
      refreshing={kpisQuery.isFetching || monthlyQuery.isFetching || submittersQuery.isFetching || purchasesQuery.isFetching || requestsQuery.isFetching}
    >
      {kpisQuery.isLoading && <SkeletonCard className="h-32" />}
      {kpisQuery.error && <ErrorState message={(kpisQuery.error as Error).message} onRetry={() => kpisQuery.refetch()} />}

      {/* Two dedicated stats tables (Part: Connects usage monitoring,
          2026-10-27, explicit user request — "create 2 separate tables for
          invites and bidding stats where I can see each and everything
          related to them") — replaces the single mixed KPI strip that used
          to interleave bidding and invite tiles. Each row is one metric so
          every bidding-only or invite-only figure (including the real-
          ledger-backed connects/cost numbers) has an unambiguous home in
          exactly one table. Profile-boost spend belongs to neither (it's
          never tied to a job or invite) and stays out of both — see its own
          callout note below the two tables. */}
      {kpis && (
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard title="Bidding Stats" subtitle={`${num(kpis.totalBids)} bids this period`}>
            <DataTable
              rowKey={(r) => r.metric}
              rows={[
                {
                  metric: "Total Bids",
                  value: num(kpis.totalBids),
                  note: <ComparisonHint deltaPct={kpis.totalBidsDeltaPct} previousValue={kpis.previousTotalBids !== undefined ? num(kpis.previousTotalBids) : undefined} />,
                },
                { metric: "Won", value: num(kpis.wonBids), note: undefined },
                { metric: "Lost", value: num(kpis.lostBids), note: undefined },
                { metric: "Viewed", value: num(kpis.bidsViewed), note: "Client opened the proposal, no further action yet" },
                { metric: "In Interview / Discussion", value: num(kpis.bidsInDiscussion), note: undefined },
                { metric: "Conversion Rate", value: pct(kpis.conversionRateBidding), note: "Won ÷ total bids" },
                {
                  metric: "Connects Used",
                  value: num(kpis.connectsUsed),
                  note:
                    kpis.connectsUsedSource === "manual_entry"
                      ? "From manually logged bids"
                      : kpis.connectsUsedSource === "real_ledger"
                        ? "From Upwork's real Connects ledger (JOB_APPLICATION, net of refunds)"
                        : "Blended — manual entries before, real ledger from when the sync started",
                },
                { metric: "Average Connects / Bid", value: num(kpis.avgConnectsPerBid), note: undefined },
                {
                  metric: "Connect Cost",
                  value: money(kpis.connectCost),
                  note:
                    kpis.connectCostBasis === "actual_purchases"
                      ? `$${kpis.connectUnitCost.toFixed(4)}/connect — your recorded purchase ledger`
                      : `Estimated at the flat $${kpis.connectUnitCost.toFixed(2)}/connect rate`,
                },
                { metric: "Cost / Bid", value: money(kpis.costPerBid), note: undefined },
                { metric: "Cost / Client (Won)", value: money(kpis.costPerClientBids), note: undefined },
              ]}
              columns={[
                { key: "metric", header: "Metric", render: (r) => r.metric },
                { key: "value", header: "Value", render: (r) => r.value, numeric: true },
                { key: "note", header: "Notes", render: (r) => r.note ?? "—" },
              ]}
            />
          </SectionCard>

          <SectionCard title="Invites Stats" subtitle={`${num(kpis.totalInvites)} invites this period`}>
            <DataTable
              rowKey={(r) => r.metric}
              rows={[
                { metric: "Total Invites", value: num(kpis.totalInvites), note: undefined },
                { metric: "Accepted", value: num(kpis.invitesAccepted), note: undefined },
                { metric: "Rejected", value: num(kpis.invitesRejected), note: undefined },
                { metric: "Won", value: num(kpis.wonInvites), note: undefined },
                { metric: "Lost", value: num(kpis.lostInvites), note: undefined },
                { metric: "In Interview / Discussion", value: num(kpis.invitesInDiscussion), note: undefined },
                { metric: "Conversion Rate", value: pct(kpis.conversionRateInvites), note: "Won ÷ total invites" },
                {
                  metric: "Connects Used",
                  value: num(kpis.connectsUsedInvites),
                  note: "Paid invitation badge (Upwork's PAID_INVITATION_BADGE) — 0 before the real Connects ledger started syncing",
                },
                {
                  metric: "Connect Cost",
                  value: money(kpis.inviteConnectCost),
                  note: kpis.connectCostBasis === "actual_purchases" ? `$${kpis.connectUnitCost.toFixed(4)}/connect` : "Estimated",
                },
                { metric: "Cost / Invite", value: money(kpis.costPerInvite), note: undefined },
              ]}
              columns={[
                { key: "metric", header: "Metric", render: (r) => r.metric },
                { key: "value", header: "Value", render: (r) => r.value, numeric: true },
                { key: "note", header: "Notes", render: (r) => r.note ?? "—" },
              ]}
            />
          </SectionCard>
        </div>
      )}

      {kpis && kpis.connectsUsedProfileBoost > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-[var(--line)] px-4 py-2.5 text-xs text-ink/60">
          <span>
            <strong className="text-ink/80">{num(kpis.connectsUsedProfileBoost)}</strong> connects spent on Profile Boost (ads) this
            period — {money(kpis.profileBoostConnectCost)} estimated. Not tied to any job or invite, so it&rsquo;s kept out of both
            tables above rather than inflating bid/invite cost.
          </span>
        </div>
      )}

      {/* Real-chart pass, round 2 (Part: Dashboard Center, 2026-10-20,
          explicit user request — "these are less charts and graphs, I need
          more"). Won/Lost/Viewed/In Discussion are each a distinct
          UpworkProposal status (confirmed by the KPI strip's own
          MetricDetail text above: "status WON", "status LOST", "status
          Viewed", "status In Discussion") — mutually exclusive by
          definition, so safe to chart as a donut. "Other" absorbs every bid
          not in one of those four named statuses (e.g. freshly submitted,
          still pending) rather than silently dropping it — the center total
          always matches totalBids/totalInvites exactly. */}
      {kpis && kpis.totalBids > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard title="Bidding Status" subtitle={`${num(kpis.totalBids)} bids this period`}>
            <DonutBreakdown
              data={[
                { label: "Won", value: kpis.wonBids, color: "rgb(var(--good-rgb))" },
                { label: "Lost", value: kpis.lostBids, color: "rgb(var(--bad-rgb))" },
                { label: "Viewed", value: kpis.bidsViewed, color: SERIES[1] },
                { label: "In Discussion", value: kpis.bidsInDiscussion, color: SERIES[2] },
                { label: "Other", value: Math.max(0, kpis.totalBids - kpis.wonBids - kpis.lostBids - kpis.bidsViewed - kpis.bidsInDiscussion), color: SERIES[3] },
              ]}
              centerValue={num(kpis.totalBids)}
              centerLabel="Total bids"
            />
          </SectionCard>
          {kpis.totalInvites > 0 && (
            <SectionCard title="Invite Status" subtitle={`${num(kpis.totalInvites)} invites this period`}>
              <DonutBreakdown
                data={[
                  { label: "Won", value: kpis.wonInvites, color: "rgb(var(--good-rgb))" },
                  { label: "Lost", value: kpis.lostInvites, color: "rgb(var(--bad-rgb))" },
                  { label: "In Discussion", value: kpis.invitesInDiscussion, color: SERIES[2] },
                  { label: "Other", value: Math.max(0, kpis.totalInvites - kpis.wonInvites - kpis.lostInvites - kpis.invitesInDiscussion), color: SERIES[3] },
                ]}
                centerValue={num(kpis.totalInvites)}
                centerLabel="Total invites"
              />
            </SectionCard>
          )}
        </div>
      )}

      <SectionCard title="Requests" expandable>
        {requestsQuery.isLoading && <SkeletonCard className="h-32" />}
        {requestsQuery.error && <ErrorState message={(requestsQuery.error as Error).message} onRetry={() => requestsQuery.refetch()} />}
        {requestsQuery.data && (
          <>
            <KpiStrip>
              <StatTile label="Requested Hours" value={num(requestsQuery.data.requestedHours)} />
              <StatTile label="Bidding Hours" value={num(requestsQuery.data.biddingHours)} />
              <StatTile label="Invite Hours" value={num(requestsQuery.data.inviteHours)} />
              <StatTile label="Total Onboarded" value={num(requestsQuery.data.totalOnboardedHours)} tone="good" />
              <StatTile label="Remaining Target" value={num(requestsQuery.data.remainingHours)} tone={requestsQuery.data.remainingHours > 0 ? "gold" : "good"} />
              <StatTile label="Pending Review" value={num(requestsQuery.data.pendingReview)} />
              <StatTile label="Approved / Rejected" value={`${num(requestsQuery.data.approvedCount)} / ${num(requestsQuery.data.rejectedCount)}`} />
            </KpiStrip>

            {requestsQuery.data.byBusinessDeveloper.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 text-xs font-medium text-ink/60">By Business Developer (the target owner)</p>
                <DataTable
                  rowKey={(r) => r.businessDeveloperId}
                  rows={requestsQuery.data.byBusinessDeveloper}
                  columns={[
                    { key: "name", header: "Business Developer", render: (r) => r.name, sortValue: (r) => r.name },
                    { key: "requestedHours", header: "Target Hours", numeric: true, render: (r) => num(r.requestedHours), sortValue: (r) => r.requestedHours },
                    { key: "achievedHours", header: "Achieved", numeric: true, render: (r) => num(r.achievedHours), sortValue: (r) => r.achievedHours },
                  ]}
                />
              </div>
            )}

            {requestsQuery.data.byProjectManager.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 text-xs font-medium text-ink/60">By Project Manager (who asked)</p>
                <DataTable
                  rowKey={(r) => r.projectManagerId}
                  rows={requestsQuery.data.byProjectManager}
                  columns={[
                    { key: "name", header: "Project Manager", render: (r) => r.name, sortValue: (r) => r.name },
                    { key: "requestedHours", header: "Approved Requested Hours", numeric: true, render: (r) => num(r.requestedHours), sortValue: (r) => r.requestedHours },
                  ]}
                />
              </div>
            )}

            {requestsQuery.data.byProfile.length > 0 && (
              <div className="mt-4">
                <DataTable
                  rowKey={(r) => r.profileName}
                  rows={requestsQuery.data.byProfile}
                  columns={[
                    { key: "profileName", header: "Profile/ID", render: (r) => r.profileName, sortValue: (r) => r.profileName },
                    { key: "requestedHours", header: "Requested", numeric: true, render: (r) => num(r.requestedHours), sortValue: (r) => r.requestedHours },
                    { key: "achievedHours", header: "Achieved", numeric: true, render: (r) => num(r.achievedHours), sortValue: (r) => r.achievedHours },
                  ]}
                />
              </div>
            )}

            {requestsQuery.data.byProjectManager.length === 0 && (
              <EmptyState title="No approved requests in this period" description="Requests are created from the Requests tab under Upwork Proposals." />
            )}
          </>
        )}
      </SectionCard>

      <SectionCard
        title="Connect purchase ledger"
        actions={
          isAdmin ? (
            <div className="flex items-center gap-2">
              <label className="cursor-pointer rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5">
                {importMutation.isPending ? "Importing…" : "Upload CSV"}
                <input type="file" accept=".csv,text/csv" onChange={handleImportFile} disabled={importMutation.isPending} className="hidden" />
              </label>
              <Button variant="secondary" size="sm" onClick={() => setShowForm((v) => !v)}>
                {showForm ? "Cancel" : "Add purchase"}
              </Button>
            </div>
          ) : undefined
        }
      >
        {importNotice && (
          <div className="mb-3 rounded-lg border border-[rgb(var(--good-rgb)/0.4)] bg-[rgb(var(--good-rgb)/0.06)] px-3 py-2 text-xs text-good">
            {importNotice}
          </div>
        )}
        {error && !showForm && (
          <div className="mb-3 rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-xs text-error">{error}</div>
        )}

        <div className="mb-4 grid grid-cols-3 gap-3">
          <StatTile
            label="Connects Purchased (This Month)"
            value={num(thisMonth?.connectsPurchased ?? 0)}
            detail={
              <MetricDetail
                definition="Sum of every UpworkConnectPurchase.connectsAmount recorded this calendar month, whether entered manually or via CSV import."
                rows={[{ label: "This month", value: num(thisMonth?.connectsPurchased ?? 0) }]}
              />
            }
          />
          <StatTile
            label="Spent on Connects (This Month)"
            value={money(thisMonth?.purchaseCost ?? 0)}
            detail={
              <MetricDetail
                definition="Sum of every UpworkConnectPurchase.totalCost recorded this calendar month."
                rows={[{ label: "This month", value: money(thisMonth?.purchaseCost ?? 0) }]}
              />
            }
          />
          <StatTile
            label="Connects Used on Bidding (This Month)"
            value={num(thisMonth?.connectsUsed ?? 0)}
            detail={
              <MetricDetail
                definition="Sum of UpworkProposal.connects across every bid submitted this calendar month — invites never consume connects, so this is bidding usage specifically."
                rows={[{ label: "This month", value: num(thisMonth?.connectsUsed ?? 0) }]}
              />
            }
          />
        </div>

        {showForm && (
          <form onSubmit={submitPurchase} className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-[var(--line)] p-3 sm:grid-cols-5">
            <label className="flex flex-col gap-1 text-[11px] text-ink/60">
              Date
              <Input type="date" value={draft.purchasedAt} onChange={(e) => setDraft({ ...draft, purchasedAt: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink/60">
              Connects
              <Input
                type="number"
                min="1"
                value={draft.connectsAmount}
                onChange={(e) => setDraft({ ...draft, connectsAmount: e.target.value })}
                placeholder="e.g. 600"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink/60">
              Total cost
              <Input
                type="number"
                min="0"
                step="0.01"
                value={draft.totalCost}
                onChange={(e) => setDraft({ ...draft, totalCost: e.target.value })}
                placeholder="e.g. 60.00"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink/60">
              Currency
              <Input value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink/60">
              Notes (optional)
              <Input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            </label>
            <div className="col-span-2 flex items-end gap-2 sm:col-span-5">
              <Button type="submit" size="sm" loading={createMutation.isPending}>
                Save purchase
              </Button>
              {error && <span className="text-xs text-error">{error}</span>}
            </div>
          </form>
        )}

        {purchasesQuery.isLoading && <SkeletonCard className="h-24" />}
        {purchasesQuery.error && <ErrorState message={(purchasesQuery.error as Error).message} onRetry={() => purchasesQuery.refetch()} />}
        {!purchasesQuery.isLoading && purchases.length === 0 && (
          <EmptyState title="No connect purchases recorded yet" description="Add one above to unlock Upwork's dollar-cost metrics." />
        )}
        {purchases.length > 0 && (
          <>
            <DataTable
              showSummary
              rowKey={(r) => r.id}
              rows={showAllPurchases ? purchases : purchases.slice(0, PURCHASE_PAGE_SIZE)}
              columns={[
                { key: "purchasedAt", header: "Date", render: (r) => dateTime(r.purchasedAt), sortValue: (r) => new Date(r.purchasedAt).getTime() },
                { key: "connectsAmount", header: "Connects", render: (r) => num(r.connectsAmount), numeric: true, sortValue: (r) => r.connectsAmount },
                { key: "totalCost", header: "Cost", render: (r) => money(r.totalCost, r.currency), numeric: true, sortValue: (r) => r.totalCost },
                { key: "notes", header: "Notes", render: (r) => r.notes ?? "—", sortValue: (r) => r.notes },
                {
                  key: "actions",
                  header: "",
                  render: (r) =>
                    isAdmin ? (
                      <button
                        type="button"
                        onClick={() => confirm("Delete this purchase record?") && deleteMutation.mutate(r.id)}
                        className="text-xs text-error hover:underline"
                      >
                        Delete
                      </button>
                    ) : null,
                },
              ]}
            />
            {purchases.length > PURCHASE_PAGE_SIZE && (
              <button
                type="button"
                onClick={() => setShowAllPurchases((v) => !v)}
                className="mt-3 text-xs text-accent hover:underline"
              >
                {showAllPurchases ? "Show less" : `View all ${purchases.length} →`}
              </button>
            )}
          </>
        )}
      </SectionCard>

      {monthlyQuery.isLoading && <SkeletonCard className="h-56" />}
      {monthlyQuery.error && <ErrorState message={(monthlyQuery.error as Error).message} onRetry={() => monthlyQuery.refetch()} />}
      {!monthlyQuery.isLoading && monthly.length === 0 && (
        <SectionCard title="Monthly trend" subtitle="Last 12 months">
          <EmptyState title="No Upwork activity in the last 12 months" />
        </SectionCard>
      )}
      {monthly.length > 0 && (
        // Real data this whole chart already had: getMonthlyTable's rows,
        // previously rendered as a table only (Part: premium dark theme
        // pass v4, 2026-10-19, explicit user request — "add some graphs...
        // represent the data more better"). Bids/Invites as grouped bars
        // ("how much per period" -> columns, not a line, since each month
        // is a discrete count, not a continuous measure) — Clients Won and
        // the two cost figures stay in the table view rather than crowding
        // a third/fourth bar onto the same chart.
        <ChartWithTable
          title="Monthly trend"
          subtitle="Last 12 months"
          expandable
          chart={
            <>
              <Legend items={[{ label: "Bids", color: SERIES[0] }, { label: "Invites", color: SERIES[1] }]} />
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={monthly}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="month" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} tickFormatter={formatCompact} allowDecimals={false} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Bar dataKey="bids" name="Bids" fill={SERIES[0]} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="invites" name="Invites" fill={SERIES[1]} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </>
          }
          table={
            <DataTable
              rowKey={(r) => r.month}
              rows={monthly}
              columns={[
                { key: "month", header: "Month", render: (r) => r.month, sortValue: (r) => r.month },
                { key: "bids", header: "Bids", render: (r) => num(r.bids), numeric: true, sortValue: (r) => r.bids },
                { key: "invites", header: "Invites", render: (r) => num(r.invites), numeric: true, sortValue: (r) => r.invites },
                { key: "connectsUsed", header: "Connects Used", render: (r) => num(r.connectsUsed), numeric: true, sortValue: (r) => r.connectsUsed },
                { key: "clientsWon", header: "Clients Won", render: (r) => num(r.clientsWon), numeric: true, sortValue: (r) => r.clientsWon },
                { key: "estimatedUsageCost", header: "Est. Cost ($0.15/connect)", render: (r) => money(r.estimatedUsageCost), numeric: true, sortValue: (r) => r.estimatedUsageCost },
                { key: "purchaseCost", header: "Actually Invoiced", render: (r) => money(r.purchaseCost), numeric: true, sortValue: (r) => r.purchaseCost },
              ]}
            />
          }
        />
      )}

      {submittersQuery.isLoading && <SkeletonCard className="h-32" />}
      {submittersQuery.error && <ErrorState message={(submittersQuery.error as Error).message} onRetry={() => submittersQuery.refetch()} />}
      {!submittersQuery.isLoading && submitters.length === 0 && (
        <SectionCard title="By submitter" subtitle="Grouped by free-text submitter name + profile">
          <EmptyState title="No submissions in this period" />
        </SectionCard>
      )}
      {submitters.length > 0 && (
        <ChartWithTable
          title="By submitter"
          expandable
          chart={
            <ResponsiveContainer width="100%" height={Math.max(140, submitters.length * 40)}>
              <BarChart
                data={[...submitters].sort((a, b) => b.won - a.won)}
                layout="vertical"
                margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
              >
                <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
                <XAxis type="number" allowDecimals={false} {...AXIS_PROPS} />
                <YAxis type="category" dataKey="name" width={140} {...AXIS_PROPS} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Bar dataKey="won" name="Won" fill="rgb(var(--good-rgb))" radius={[0, 4, 4, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          }
          table={
            <DataTable
              showSummary
              rowKey={(r) => `${r.name}-${r.profileName}`}
              rows={submitters}
              columns={[
                { key: "name", header: "Submitter", render: (r) => r.name, sortValue: (r) => r.name },
                { key: "profileName", header: "Profile/ID", render: (r) => r.profileName, sortValue: (r) => r.profileName },
                { key: "bids", header: "Bids", render: (r) => num(r.bids), numeric: true, sortValue: (r) => r.bids },
                { key: "invites", header: "Invites", render: (r) => num(r.invites), numeric: true, sortValue: (r) => r.invites },
                { key: "won", header: "Won", render: (r) => num(r.won), numeric: true, sortValue: (r) => r.won },
                { key: "lost", header: "Lost", render: (r) => num(r.lost), numeric: true, sortValue: (r) => r.lost },
                { key: "onboardedHours", header: "Onboarded Hours", render: (r) => num(r.onboardedHours), numeric: true, sortValue: (r) => r.onboardedHours },
                { key: "conversionRate", header: "Conv. Rate", render: (r) => pct(r.conversionRate), numeric: true, sortValue: (r) => r.conversionRate },
                { key: "estimatedCost", header: "Est. Cost ($0.15/connect)", render: (r) => money(r.estimatedCost), numeric: true, sortValue: (r) => r.estimatedCost },
              ]}
            />
          }
        />
      )}
    </DashboardCenterShell>
  );
}
