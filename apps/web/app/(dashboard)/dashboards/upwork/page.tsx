"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getCurrentUser } from "../../../../lib/api-client";
import { DashboardCenterShell, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";
import { dashboardRangeToQuery } from "../../../../components/dashboard-center/date-range-bar";
import { num, pct, money, dateTime } from "../../../../components/dashboard-center/format";
import { DataTable, SectionCard, StatTile } from "../../../../components/chart-kit";
import { ErrorState } from "../../../../components/ui/error-state";
import { SkeletonCard } from "../../../../components/ui/skeleton";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Input } from "../../../../components/ui/input";
import { Button } from "../../../../components/ui/button";

interface UpworkKpis {
  totalBids: number;
  totalInvites: number;
  invitesAccepted: number;
  invitesRejected: number;
  clientsWon: number;
  clientsLost: number;
  connectsUsed: number;
  connectCostAvailable: boolean;
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
    >
      {kpisQuery.isLoading && <SkeletonCard className="h-32" />}
      {kpisQuery.error && <ErrorState message={(kpisQuery.error as Error).message} onRetry={() => kpisQuery.refetch()} />}

      {kpis && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatTile label="Total Bids" value={num(kpis.totalBids)} />
          <StatTile label="Total Invites" value={num(kpis.totalInvites)} />
          <StatTile label="Invites Accepted" value={num(kpis.invitesAccepted)} />
          <StatTile label="Clients Won" value={num(kpis.clientsWon)} tone="good" />
          <StatTile label="Clients Lost" value={num(kpis.clientsLost)} tone="bad" />
          <StatTile label="Conversion Rate" value={pct(kpis.conversionRate)} />
          <StatTile label="Connects Used" value={num(kpis.connectsUsed)} />
          <StatTile label="Bids / Client" value={num(kpis.bidsPerClient)} />
          <StatTile
            label="Connect Cost"
            value={kpis.connectCostAvailable ? money(kpis.connectCost) : "Unavailable"}
            hint={!kpis.connectCostAvailable ? "No connect purchases on record yet" : undefined}
          />
          <StatTile
            label="Cost / Client"
            value={kpis.connectCostAvailable ? money(kpis.costPerClient) : "Unavailable"}
            hint={!kpis.connectCostAvailable ? "No connect purchases on record yet" : undefined}
          />
        </div>
      )}

      <SectionCard
        title="Connect purchase ledger"
        subtitle="Manually entered — Upwork's API exposes no per-connect pricing, so every $ metric above stays unavailable until at least one real purchase is on record"
        actions={
          isAdmin ? (
            <Button variant="secondary" size="sm" onClick={() => setShowForm((v) => !v)}>
              {showForm ? "Cancel" : "Add purchase"}
            </Button>
          ) : undefined
        }
      >
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

      <SectionCard title="Monthly trend" subtitle="Last 12 months">
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
              { key: "purchaseCost", header: "Connects Bought ($)", render: (r) => money(r.purchaseCost), numeric: true },
            ]}
          />
        )}
      </SectionCard>

      <SectionCard title="By submitter" subtitle="Grouped by free-text submitter name — may fragment on typos/casing since it's not a User relation">
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
            ]}
          />
        )}
      </SectionCard>
    </DashboardCenterShell>
  );
}
