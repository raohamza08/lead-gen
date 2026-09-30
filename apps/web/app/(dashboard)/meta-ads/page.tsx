"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../../lib/api-client";
import { useSelectedMetaAdAccount } from "../../../lib/use-meta-ads-account";
import { AXIS_PROPS, ChartWithTable, DataTable, GRID_PROPS, SERIES, SINGLE_SERIES, TOOLTIP_STYLE, formatCompact } from "../../../components/chart-kit";
import { ComparisonTile } from "../../../components/meta-ads/comparison-tile";
import { money, num, pct } from "../../../components/meta-ads/format";
import { MetaAdsAccountStatusBar, MetaAdAccountRow } from "../../../components/meta-ads/account-status-bar";
import { MetaAdsDateRangeBar, defaultMetaAdsDateRange, metaAdsRangeToQuery } from "../../../components/meta-ads/date-range-bar";
import { EmptyState } from "../../../components/ui/empty-state";
import { ErrorState } from "../../../components/ui/error-state";
import { SkeletonCard } from "../../../components/ui/skeleton";

interface Metrics {
  impressions: number;
  reach: number;
  frequency?: number;
  clicks: number;
  linkClicks: number;
  spend: number;
  ctr?: number;
  cpc?: number;
  cpm?: number;
  videoViews?: number;
  landingPageViews?: number;
  purchases?: number;
  leads?: number;
  addToCart?: number;
  postEngagements?: number;
  conversionValue?: number;
  roas?: number;
  conversions?: number;
  costPerConversion?: number;
  otherActions: Record<string, number>;
}

interface OverviewResponse {
  account: { id: string; name: string; currency: string | null; status: string; lastSyncAt: string | null; lastSyncError: string | null };
  current: Metrics;
  previous: Metrics | null;
  deltas: Record<string, number | null> | null;
}

type TimeseriesPoint = Metrics & { date: string };

export default function MetaAdsOverviewPage() {
  const [range, setRange] = useState(defaultMetaAdsDateRange(30));
  const accountsQuery = useQuery({ queryKey: ["meta-ads-accounts"], queryFn: () => api.getMetaAdsAccounts() as Promise<MetaAdAccountRow[]> });
  const accounts = accountsQuery.data ?? [];
  const [selectedId, selectAccount] = useSelectedMetaAdAccount(accounts);

  const overviewQuery = useQuery({
    queryKey: ["meta-ads-overview", selectedId, range],
    queryFn: () => api.getMetaAdsOverview(selectedId as string, metaAdsRangeToQuery(range)) as Promise<OverviewResponse>,
    enabled: Boolean(selectedId),
  });
  const timeseriesQuery = useQuery({
    queryKey: ["meta-ads-timeseries", selectedId, range],
    queryFn: () => api.getMetaAdsTimeseries(selectedId as string, metaAdsRangeToQuery(range)) as Promise<TimeseriesPoint[]>,
    enabled: Boolean(selectedId),
  });

  if (accountsQuery.isLoading) return <SkeletonCard className="h-64" />;
  if (accountsQuery.error) return <ErrorState message={(accountsQuery.error as Error).message} onRetry={() => accountsQuery.refetch()} />;
  if (accounts.length === 0) {
    return (
      <EmptyState
        title="No Meta Ads account connected"
        description="Connect a Meta ad account to see spend, reach, and conversion reporting here."
        action={
          <a href="/settings/meta-ads" className="rounded-md bg-accent px-3 py-1.5 text-sm text-white">
            Connect Meta Ads
          </a>
        }
      />
    );
  }

  const currency = accounts.find((a) => a.id === selectedId)?.currency;
  const data = overviewQuery.data;
  const series = timeseriesQuery.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Meta Ads</h1>
        <p className="mt-0.5 text-xs text-ink/50">Advertising performance synced from the Meta Marketing API.</p>
      </div>

      <MetaAdsAccountStatusBar
        accounts={accounts}
        selectedId={selectedId}
        onSelect={selectAccount}
        onSynced={() => {
          overviewQuery.refetch();
          timeseriesQuery.refetch();
          accountsQuery.refetch();
        }}
      />
      <MetaAdsDateRangeBar value={range} onChange={setRange} />

      {overviewQuery.isLoading && <SkeletonCard className="h-40" />}
      {overviewQuery.error && <ErrorState message={(overviewQuery.error as Error).message} onRetry={() => overviewQuery.refetch()} />}

      {data && (
        <>
          {data.current.impressions === 0 && data.current.spend === 0 ? (
            <EmptyState title="No data for this period" description="Try a wider date range, or Sync now if this account was just connected." />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <ComparisonTile label="Total Spend" value={money(data.current.spend, currency)} deltaPct={data.deltas?.spend} />
              <ComparisonTile label="Impressions" value={num(data.current.impressions)} deltaPct={data.deltas?.impressions} />
              <ComparisonTile
                label="Reach"
                value={num(data.current.reach)}
                deltaPct={data.deltas?.reach}
                hint="Sum of each ad's own reach for the period — not deduplicated across ads/days, so it can exceed true unique people reached."
              />
              <ComparisonTile label="Clicks" value={num(data.current.clicks)} deltaPct={data.deltas?.clicks} />
              <ComparisonTile label="CTR" value={pct(data.current.ctr)} deltaPct={data.deltas?.ctr} />
              <ComparisonTile label="CPC" value={money(data.current.cpc, currency)} deltaPct={data.deltas?.cpc} />
              <ComparisonTile label="CPM" value={money(data.current.cpm, currency)} deltaPct={data.deltas?.cpm} />
              <ComparisonTile
                label="Conversions"
                value={num(data.current.conversions)}
                deltaPct={data.deltas?.conversions}
                hint="Purchases + Leads + Add to Cart, whichever action types this data actually contains — a blended figure, not a single Meta field."
              />
              <ComparisonTile label="ROAS" value={data.current.roas !== undefined ? `${data.current.roas.toFixed(2)}x` : "—"} deltaPct={data.deltas?.roas} />
              <ComparisonTile label="Cost / Conversion" value={money(data.current.costPerConversion, currency)} />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
            <ComparisonTile label="Purchases" value={num(data.current.purchases)} />
            <ComparisonTile label="Leads" value={num(data.current.leads)} />
            <ComparisonTile label="Add to Cart" value={num(data.current.addToCart)} />
            <ComparisonTile label="Conversion Value" value={money(data.current.conversionValue, currency)} />
            <ComparisonTile label="Landing Page Views" value={num(data.current.landingPageViews)} />
            <ComparisonTile label="Video Views" value={num(data.current.videoViews)} />
            <ComparisonTile label="Engagements" value={num(data.current.postEngagements)} />
            <ComparisonTile label="Link Clicks" value={num(data.current.linkClicks)} />
          </div>

          {Object.keys(data.current.otherActions).length > 0 && (
            <div className="card p-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/55">Other actions Meta returned</h3>
              <div className="flex flex-wrap gap-2 text-xs">
                {Object.entries(data.current.otherActions).map(([type, value]) => (
                  <span key={type} className="rounded-full bg-ink/5 px-2 py-1 text-ink/70">
                    {type}: {formatCompact(value)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {series.length > 0 && (
        <>
          <ChartWithTable
            title="Spend over time"
            chart={
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={series}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="date" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} tickFormatter={formatCompact} />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => money(v, currency)} />
                  <Area type="monotone" dataKey="spend" stroke={SINGLE_SERIES} fill={SINGLE_SERIES} fillOpacity={0.15} />
                </AreaChart>
              </ResponsiveContainer>
            }
            table={
              <DataTable
                rowKey={(r) => r.date}
                rows={series}
                columns={[
                  { key: "date", header: "Date", render: (r) => r.date },
                  { key: "spend", header: "Spend", render: (r) => money(r.spend, currency), numeric: true },
                ]}
              />
            }
          />

          <ChartWithTable
            title="Impressions & Reach"
            chart={
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={series}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="date" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} tickFormatter={formatCompact} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Line type="monotone" dataKey="impressions" stroke={SERIES[0]} dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="reach" stroke={SERIES[1]} dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            }
            table={
              <DataTable
                rowKey={(r) => r.date}
                rows={series}
                columns={[
                  { key: "date", header: "Date", render: (r) => r.date },
                  { key: "impressions", header: "Impressions", render: (r) => num(r.impressions), numeric: true },
                  { key: "reach", header: "Reach", render: (r) => num(r.reach), numeric: true },
                ]}
              />
            }
          />

          <ChartWithTable
            title="Clicks & CTR"
            chart={
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={series}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="date" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} tickFormatter={formatCompact} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Bar dataKey="clicks" fill={SERIES[2]} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            }
            table={
              <DataTable
                rowKey={(r) => r.date}
                rows={series}
                columns={[
                  { key: "date", header: "Date", render: (r) => r.date },
                  { key: "clicks", header: "Clicks", render: (r) => num(r.clicks), numeric: true },
                  { key: "ctr", header: "CTR", render: (r) => pct(r.ctr), numeric: true },
                  { key: "cpc", header: "CPC", render: (r) => money(r.cpc, currency), numeric: true },
                ]}
              />
            }
          />

          <ChartWithTable
            title="Conversions & ROAS"
            chart={
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={series}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="date" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} tickFormatter={formatCompact} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Line type="monotone" dataKey="conversions" stroke={SERIES[3]} dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            }
            table={
              <DataTable
                rowKey={(r) => r.date}
                rows={series}
                columns={[
                  { key: "date", header: "Date", render: (r) => r.date },
                  { key: "conversions", header: "Conversions", render: (r) => num(r.conversions), numeric: true },
                  { key: "roas", header: "ROAS", render: (r) => (r.roas !== undefined ? `${r.roas.toFixed(2)}x` : "—"), numeric: true },
                  { key: "conversionValue", header: "Conversion Value", render: (r) => money(r.conversionValue, currency), numeric: true },
                ]}
              />
            }
          />
        </>
      )}
    </div>
  );
}
