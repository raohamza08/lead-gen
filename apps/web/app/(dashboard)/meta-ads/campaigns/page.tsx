"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { useSelectedMetaAdAccount } from "../../../../lib/use-meta-ads-account";
import { DataTable, SectionCard } from "../../../../components/chart-kit";
import { MetaAdsAccountStatusBar, MetaAdAccountRow } from "../../../../components/meta-ads/account-status-bar";
import { MetaAdsDateRangeBar, defaultMetaAdsDateRange, metaAdsRangeToQuery } from "../../../../components/meta-ads/date-range-bar";
import { MetaAdsTableToolbar, MetaAdsPagination } from "../../../../components/meta-ads/table-toolbar";
import { money, num, pct, roas } from "../../../../components/meta-ads/format";
import { EmptyState } from "../../../../components/ui/empty-state";
import { ErrorState } from "../../../../components/ui/error-state";
import { SkeletonCard } from "../../../../components/ui/skeleton";

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  objective: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr?: number;
  cpc?: number;
  cpm?: number;
  results?: number;
  costPerResult?: number;
  roas?: number;
}

const SORT_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "spend", label: "Spend" },
  { value: "impressions", label: "Impressions" },
  { value: "clicks", label: "Clicks" },
  { value: "ctr", label: "CTR" },
  { value: "cpc", label: "CPC" },
  { value: "roas", label: "ROAS" },
];

export default function MetaAdsCampaignsPage() {
  const [range, setRange] = useState(defaultMetaAdsDateRange(30));
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sortBy, setSortBy] = useState("spend");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  const accountsQuery = useQuery({ queryKey: ["meta-ads-accounts"], queryFn: () => api.getMetaAdsAccounts() as Promise<MetaAdAccountRow[]> });
  const accounts = accountsQuery.data ?? [];
  const [selectedId, selectAccount] = useSelectedMetaAdAccount(accounts);
  const currency = accounts.find((a) => a.id === selectedId)?.currency;

  const query = useQuery({
    queryKey: ["meta-ads-campaigns", selectedId, range, search, status, sortBy, sortDir, page],
    queryFn: () =>
      api.getMetaAdsCampaigns(selectedId as string, {
        ...metaAdsRangeToQuery(range),
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
        sortBy,
        sortDir,
        page: String(page),
        pageSize: "25",
      }) as Promise<{ rows: CampaignRow[]; total: number; page: number; pageSize: number }>,
    enabled: Boolean(selectedId),
  });

  if (accountsQuery.isLoading) return <SkeletonCard className="h-64" />;
  if (accounts.length === 0) {
    return <EmptyState title="No Meta Ads account connected" action={<a href="/settings/meta-ads" className="rounded-md bg-accent px-3 py-1.5 text-sm text-white">Connect Meta Ads</a>} />;
  }

  const rows = query.data?.rows ?? [];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold tracking-tight">Campaigns</h1>
      <MetaAdsAccountStatusBar accounts={accounts} selectedId={selectedId} onSelect={selectAccount} onSynced={() => query.refetch()} />
      <MetaAdsDateRangeBar value={range} onChange={setRange} />

      <SectionCard title="All campaigns">
        <div className="flex flex-col gap-3">
          <MetaAdsTableToolbar
            search={search}
            onSearchChange={(v) => { setSearch(v); setPage(1); }}
            sortBy={sortBy}
            onSortByChange={setSortBy}
            sortDir={sortDir}
            onSortDirChange={setSortDir}
            sortOptions={SORT_OPTIONS}
            extraFilters={
              <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="rounded-md border border-[var(--line)] bg-transparent px-2 py-1.5 text-xs">
                <option value="">All statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="PAUSED">Paused</option>
                <option value="ARCHIVED">Archived</option>
                <option value="DELETED">Deleted</option>
              </select>
            }
          />

          {query.isLoading && <SkeletonCard className="h-40" />}
          {query.error && <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />}
          {query.data && rows.length === 0 && <EmptyState title="No campaigns match these filters" />}

          {rows.length > 0 && (
            <>
              <DataTable
                rowKey={(r) => r.id}
                rows={rows}
                columns={[
                  { key: "name", header: "Campaign", render: (r) => <span title={r.id}>{r.name}</span> },
                  { key: "status", header: "Status", render: (r) => r.status },
                  { key: "objective", header: "Objective", render: (r) => r.objective ?? "—" },
                  { key: "dailyBudget", header: "Budget", render: (r) => money(r.dailyBudget ?? r.lifetimeBudget ?? undefined, currency), numeric: true },
                  { key: "spend", header: "Spend", render: (r) => money(r.spend, currency), numeric: true },
                  { key: "impressions", header: "Impressions", render: (r) => num(r.impressions), numeric: true },
                  { key: "reach", header: "Reach", render: (r) => num(r.reach), numeric: true },
                  { key: "clicks", header: "Clicks", render: (r) => num(r.clicks), numeric: true },
                  { key: "ctr", header: "CTR", render: (r) => pct(r.ctr), numeric: true },
                  { key: "cpc", header: "CPC", render: (r) => money(r.cpc, currency), numeric: true },
                  { key: "cpm", header: "CPM", render: (r) => money(r.cpm, currency), numeric: true },
                  { key: "results", header: "Results", render: (r) => num(r.results), numeric: true },
                  { key: "costPerResult", header: "Cost/Result", render: (r) => money(r.costPerResult, currency), numeric: true },
                  { key: "roas", header: "ROAS", render: (r) => roas(r.roas), numeric: true },
                ]}
              />
              <MetaAdsPagination page={query.data?.page ?? 1} pageSize={query.data?.pageSize ?? 25} total={query.data?.total ?? 0} onPageChange={setPage} />
            </>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
