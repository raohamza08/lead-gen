"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getCurrentUser } from "../../../../lib/api-client";
import { DashboardCenterShell, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";
import { dashboardRangeToQuery } from "../../../../components/dashboard-center/date-range-bar";
import { num, pct, money, dateTime } from "../../../../components/dashboard-center/format";
import { MetricDetail, ComparisonHint } from "../../../../components/dashboard-center/metric-detail";
import { DataTable, SectionCard, StatTile } from "../../../../components/chart-kit";
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
  connectsUsed: number;
  connectCostAvailable: boolean;
  connectCostBasis: "actual_purchases" | "flat_rate_estimate";
  connectUnitCost: number;
  connectCost?: number;
  costPerBid?: number;
  costPerClient?: number;
  costPerInvite?: number;
  bidsPerClient?: number;
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

interface SubmitterRow {
  name: string;
  bids: number;
  invites: number;
  connects: number;
  won: number;
  lost: number;
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

export default function UpworkDashboardPage() {
  const [dateRange, setDateRange] = useDashboardDateRange();
  const query = dashboardRangeToQuery(dateRange);
  const isAdmin = getCurrentUser()?.role === "ADMIN";
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(EMPTY_PURCHASE);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

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

  return (
    <DashboardCenterShell
      title="Upwork Dashboard"
      subtitle="Bids, invites, and win rate. Dollar-cost metrics require at least one connect purchase entered below — Upwork's API exposes no pricing data."
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      onRefresh={() => {
        kpisQuery.refetch();
        monthlyQuery.refetch();
        submittersQuery.refetch();
        purchasesQuery.refetch();
      }}
      refreshing={kpisQuery.isFetching || monthlyQuery.isFetching || submittersQuery.isFetching || purchasesQuery.isFetching}
    >
      {kpisQuery.isLoading && <SkeletonCard className="h-32" />}
      {kpisQuery.error && <ErrorState message={(kpisQuery.error as Error).message} onRetry={() => kpisQuery.refetch()} />}

      {kpis && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatTile
            label="Total Bids"
            value={num(kpis.totalBids)}
            hint={<ComparisonHint deltaPct={kpis.totalBidsDeltaPct} previousValue={kpis.previousTotalBids !== undefined ? num(kpis.previousTotalBids) : undefined} />}
            detail={<MetricDetail definition="Proposals of type BIDDING submitted in the selected period." rows={[{ label: "Bids", value: num(kpis.totalBids) }]} />}
          />
          <StatTile
            label="Total Invites"
            value={num(kpis.totalInvites)}
            detail={
              <MetricDetail
                definition="Proposals of type INVITE received in the selected period."
                rows={[
                  { label: "Invites", value: num(kpis.totalInvites) },
                  { label: "Accepted", value: num(kpis.invitesAccepted) },
                  { label: "Rejected", value: num(kpis.invitesRejected) },
                ]}
              />
            }
          />
          <StatTile
            label="Invites Accepted"
            value={num(kpis.invitesAccepted)}
            detail={<MetricDetail definition="Invites with status Accepted, In Discussion, Follow-up 1/2, or Won." rows={[{ label: "Accepted", value: num(kpis.invitesAccepted) }, { label: "Total invites", value: num(kpis.totalInvites) }]} />}
          />
          <StatTile
            label="Clients Won"
            value={num(kpis.clientsWon)}
            tone="good"
            hint={<ComparisonHint deltaPct={kpis.clientsWonDeltaPct} previousValue={kpis.previousClientsWon !== undefined ? num(kpis.previousClientsWon) : undefined} />}
            detail={<MetricDetail definition="Proposals (bids or invites) with status WON in the selected period." rows={[{ label: "Won", value: num(kpis.clientsWon) }]} />}
          />
          <StatTile
            label="Clients Lost"
            value={num(kpis.clientsLost)}
            tone="bad"
            detail={<MetricDetail definition="Proposals (bids or invites) with status LOST in the selected period." rows={[{ label: "Lost", value: num(kpis.clientsLost) }]} />}
          />
          <StatTile
            label="Conversion Rate"
            value={pct(kpis.conversionRate)}
            detail={
              <MetricDetail
                definition="Won divided by (bids + invites)."
                rows={[
                  { label: "Won", value: num(kpis.clientsWon) },
                  { label: "Bids + invites", value: num(kpis.totalBids + kpis.totalInvites) },
                  { label: "Rate", value: pct(kpis.conversionRate) },
                ]}
              />
            }
          />
          <StatTile
            label="Connects Used"
            value={num(kpis.connectsUsed)}
            detail={<MetricDetail definition="Sum of UpworkProposal.connects across every proposal submitted in the selected period." rows={[{ label: "Connects used", value: num(kpis.connectsUsed) }]} />}
          />
          <StatTile
            label="Bids / Client"
            value={num(kpis.bidsPerClient)}
            detail={<MetricDetail definition="Total bids divided by clients won — how many bids it typically takes to land one client." rows={[{ label: "Bids", value: num(kpis.totalBids) }, { label: "Clients won", value: num(kpis.clientsWon) }]} />}
          />
          <StatTile
            label="Connect Cost"
            value={money(kpis.connectCost)}
            hint={
              kpis.connectCostBasis === "actual_purchases"
                ? `Based on recorded purchases — $${kpis.connectUnitCost.toFixed(4)}/connect`
                : `Estimated at the flat $${kpis.connectUnitCost.toFixed(2)}/connect rate — no purchases recorded yet`
            }
            detail={
              <MetricDetail
                definition={
                  kpis.connectCostBasis === "actual_purchases"
                    ? "Connects used multiplied by the weighted-average cost per connect from your recorded purchase ledger."
                    : "Connects used multiplied by the flat $0.15/connect rate — no purchases are on record yet, so this is an estimate rather than an actual invoiced figure."
                }
                rows={[
                  { label: "Connects used", value: num(kpis.connectsUsed) },
                  { label: "Rate per connect", value: money(kpis.connectUnitCost) },
                  { label: "Total cost", value: money(kpis.connectCost) },
                ]}
                footnote={kpis.connectCostBasis === "flat_rate_estimate" ? "Add a real purchase below to replace this estimate with your actual invoiced rate." : undefined}
              />
            }
          />
          <StatTile
            label="Cost / Bid"
            value={money(kpis.costPerBid)}
            hint={kpis.connectCostBasis === "flat_rate_estimate" ? "Estimated" : undefined}
            detail={<MetricDetail definition="Connect cost divided by total bids." rows={[{ label: "Connect cost", value: money(kpis.connectCost) }, { label: "Total bids", value: num(kpis.totalBids) }]} />}
          />
          <StatTile
            label="Cost / Client"
            value={money(kpis.costPerClient)}
            hint={kpis.connectCostBasis === "flat_rate_estimate" ? "Estimated" : undefined}
            detail={<MetricDetail definition="Connect cost divided by clients won." rows={[{ label: "Connect cost", value: money(kpis.connectCost) }, { label: "Clients won", value: num(kpis.clientsWon) }]} />}
          />
          <StatTile
            label="Cost / Invite"
            value={money(kpis.costPerInvite)}
            hint={kpis.connectCostBasis === "flat_rate_estimate" ? "Estimated" : undefined}
            detail={<MetricDetail definition="Connect cost divided by total invites." rows={[{ label: "Connect cost", value: money(kpis.connectCost) }, { label: "Total invites", value: num(kpis.totalInvites) }]} />}
          />
        </div>
      )}

      <SectionCard
        title="Connect purchase ledger"
        subtitle="Upload Upwork's own Transaction Report CSV, or add purchases manually — recorded purchases replace the $0.15/connect estimate above with your actual invoiced rate"
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
          <DataTable
            rowKey={(r) => r.id}
            rows={purchases}
            columns={[
              { key: "purchasedAt", header: "Date", render: (r) => dateTime(r.purchasedAt) },
              { key: "connectsAmount", header: "Connects", render: (r) => num(r.connectsAmount), numeric: true },
              { key: "totalCost", header: "Cost", render: (r) => money(r.totalCost, r.currency), numeric: true },
              { key: "notes", header: "Notes", render: (r) => r.notes ?? "—" },
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
        )}
      </SectionCard>

      <SectionCard title="Monthly trend" subtitle="Last 12 months" expandable>
        {monthlyQuery.isLoading && <SkeletonCard className="h-32" />}
        {monthlyQuery.error && <ErrorState message={(monthlyQuery.error as Error).message} onRetry={() => monthlyQuery.refetch()} />}
        {!monthlyQuery.isLoading && monthly.length === 0 && <EmptyState title="No Upwork activity in the last 12 months" />}
        {monthly.length > 0 && (
          <DataTable
            rowKey={(r) => r.month}
            rows={monthly}
            columns={[
              { key: "month", header: "Month", render: (r) => r.month },
              { key: "bids", header: "Bids", render: (r) => num(r.bids), numeric: true },
              { key: "invites", header: "Invites", render: (r) => num(r.invites), numeric: true },
              { key: "connectsUsed", header: "Connects Used", render: (r) => num(r.connectsUsed), numeric: true },
              { key: "clientsWon", header: "Clients Won", render: (r) => num(r.clientsWon), numeric: true },
              { key: "estimatedUsageCost", header: "Est. Cost ($0.15/connect)", render: (r) => money(r.estimatedUsageCost), numeric: true },
              { key: "purchaseCost", header: "Actually Invoiced", render: (r) => money(r.purchaseCost), numeric: true },
            ]}
          />
        )}
      </SectionCard>

      <SectionCard title="By submitter" subtitle="Grouped by free-text submitter name — may fragment on typos/casing since it's not a User relation" expandable>
        {submittersQuery.isLoading && <SkeletonCard className="h-32" />}
        {submittersQuery.error && <ErrorState message={(submittersQuery.error as Error).message} onRetry={() => submittersQuery.refetch()} />}
        {!submittersQuery.isLoading && submitters.length === 0 && <EmptyState title="No submissions in this period" />}
        {submitters.length > 0 && (
          <DataTable
            rowKey={(r) => r.name}
            rows={submitters}
            columns={[
              { key: "name", header: "Submitter", render: (r) => r.name },
              { key: "bids", header: "Bids", render: (r) => num(r.bids), numeric: true },
              { key: "invites", header: "Invites", render: (r) => num(r.invites), numeric: true },
              { key: "won", header: "Won", render: (r) => num(r.won), numeric: true },
              { key: "lost", header: "Lost", render: (r) => num(r.lost), numeric: true },
              { key: "conversionRate", header: "Conv. Rate", render: (r) => pct(r.conversionRate), numeric: true },
              { key: "estimatedCost", header: "Est. Cost ($0.15/connect)", render: (r) => money(r.estimatedCost), numeric: true },
            ]}
          />
        )}
      </SectionCard>
    </DashboardCenterShell>
  );
}
