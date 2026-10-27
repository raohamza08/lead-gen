"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, getCurrentUser } from "../../../../lib/api-client";
import { DashboardCenterShell, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";
import { dashboardRangeToQuery } from "../../../../components/dashboard-center/date-range-bar";
import { num, pct } from "../../../../components/dashboard-center/format";
import {
  AXIS_PROPS,
  ChartWithTable,
  DashboardIcons,
  DataTable,
  DonutBreakdown,
  GRID_PROPS,
  Legend,
  MiniTrendCard,
  RadialProgress,
  SectionCard,
  SERIES,
  StatCardWithSparkline,
  TOOLTIP_STYLE,
  TREND_DURATION_OPTIONS,
  formatCompact,
} from "../../../../components/chart-kit";
import { ErrorState } from "../../../../components/ui/error-state";
import { SkeletonCard } from "../../../../components/ui/skeleton";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Input } from "../../../../components/ui/input";
import { Button } from "../../../../components/ui/button";

interface GaOverview {
  totalUsers: number;
  sessions: number;
  pageViews: number;
  engagementRate?: number;
  avgSessionSeconds?: number;
  totalUsersDeltaPct: number | null;
  sessionsDeltaPct: number | null;
  pageViewsDeltaPct: number | null;
}

interface GaTimeseriesPoint {
  [key: string]: string | number;
  date: string;
  totalUsers: number;
  sessions: number;
  pageViews: number;
  avgSessionSeconds: number;
  engagementRate: number;
}

interface GaBreakdownRow {
  label: string;
  value: number;
}

interface GaPageRow {
  path: string;
  views: number;
}

function avgSessionLabel(seconds: number | undefined): string {
  if (seconds === undefined) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

const { Users: UsersIcon, Pulse: PulseIcon, Eye: EyeIcon, Clock: ClockIcon } = DashboardIcons;

/** Website Analytics — real GA4 data via a read-only service account (Part:
 *  Dashboard Center, 2026-10-20, explicit user request — "i have a website
 *  and i want to see its stats here on outly... connected to
 *  analytics.google.com"). Every query below only fires once a GA4 property
 *  is actually connected (`status.connected`), same gating pattern as the
 *  Meta Ads tab's `accounts.length === 0` check. */
export function WebsiteAnalyticsTab() {
  const [dateRange, setDateRange] = useDashboardDateRange();
  const query = dashboardRangeToQuery(dateRange);
  const isAdmin = getCurrentUser()?.role === "ADMIN";
  const queryClient = useQueryClient();
  const [propertyIdDraft, setPropertyIdDraft] = useState("");

  const statusQuery = useQuery({
    queryKey: ["dc-ga-status"],
    queryFn: () => api.getWebsiteAnalyticsStatus() as Promise<{ connected: boolean; propertyId: string | null }>,
  });
  const connected = statusQuery.data?.connected ?? false;

  const setPropertyMutation = useMutation({
    mutationFn: (propertyId: string) => api.setWebsiteAnalyticsProperty(propertyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dc-ga-status"] });
      queryClient.invalidateQueries({ queryKey: ["dc-ga"] });
    },
  });

  const overviewQuery = useQuery({
    queryKey: ["dc-ga-overview", query],
    queryFn: () => api.getWebsiteAnalyticsOverview(query) as Promise<GaOverview>,
    enabled: connected,
  });
  const timeseriesQuery = useQuery({
    queryKey: ["dc-ga-timeseries", query],
    queryFn: () => api.getWebsiteAnalyticsTimeseries(query) as Promise<GaTimeseriesPoint[]>,
    enabled: connected,
  });

  // Independent per-card duration (Part: Dashboard Center, 2026-10-20,
  // explicit user request — "there should be option in each chart to
  // change the duration time for the single chart"). Each trend card
  // starts on the page's own range (reusing the already-fetched `series`,
  // no extra request) and only fires its OWN fetch once its duration
  // diverges from the page -- same getWebsiteAnalyticsTimeseries endpoint,
  // just a different range, so a card can never show data that didn't
  // really happen, only a different real window of it.
  const [usersDuration, setUsersDuration] = useState<string>(dateRange.range);
  const [sessionsDuration, setSessionsDuration] = useState<string>(dateRange.range);
  const [pageViewsDuration, setPageViewsDuration] = useState<string>(dateRange.range);
  const [avgSessionDurationRange, setAvgSessionDurationRange] = useState<string>(dateRange.range);
  const usersTrendQuery = useQuery({
    queryKey: ["dc-ga-timeseries-card", "users", usersDuration],
    queryFn: () => api.getWebsiteAnalyticsTimeseries({ range: usersDuration }) as Promise<GaTimeseriesPoint[]>,
    enabled: connected && usersDuration !== dateRange.range,
  });
  const sessionsTrendQuery = useQuery({
    queryKey: ["dc-ga-timeseries-card", "sessions", sessionsDuration],
    queryFn: () => api.getWebsiteAnalyticsTimeseries({ range: sessionsDuration }) as Promise<GaTimeseriesPoint[]>,
    enabled: connected && sessionsDuration !== dateRange.range,
  });
  const pageViewsTrendQuery = useQuery({
    queryKey: ["dc-ga-timeseries-card", "pageViews", pageViewsDuration],
    queryFn: () => api.getWebsiteAnalyticsTimeseries({ range: pageViewsDuration }) as Promise<GaTimeseriesPoint[]>,
    enabled: connected && pageViewsDuration !== dateRange.range,
  });
  const avgSessionTrendQuery = useQuery({
    queryKey: ["dc-ga-timeseries-card", "avgSession", avgSessionDurationRange],
    queryFn: () => api.getWebsiteAnalyticsTimeseries({ range: avgSessionDurationRange }) as Promise<GaTimeseriesPoint[]>,
    enabled: connected && avgSessionDurationRange !== dateRange.range,
  });
  const usersTrendData = usersDuration === dateRange.range ? undefined : usersTrendQuery.data;
  const sessionsTrendData = sessionsDuration === dateRange.range ? undefined : sessionsTrendQuery.data;
  const pageViewsTrendData = pageViewsDuration === dateRange.range ? undefined : pageViewsTrendQuery.data;
  const avgSessionTrendData = avgSessionDurationRange === dateRange.range ? undefined : avgSessionTrendQuery.data;
  const sourcesQuery = useQuery({
    queryKey: ["dc-ga-sources", query],
    queryFn: () => api.getWebsiteAnalyticsTrafficSources(query) as Promise<GaBreakdownRow[]>,
    enabled: connected,
  });
  const pagesQuery = useQuery({
    queryKey: ["dc-ga-pages", query],
    queryFn: () => api.getWebsiteAnalyticsTopPages(query) as Promise<GaPageRow[]>,
    enabled: connected,
  });
  const audienceQuery = useQuery({
    queryKey: ["dc-ga-audience", query],
    queryFn: () => api.getWebsiteAnalyticsAudience(query) as Promise<{ devices: GaBreakdownRow[]; countries: GaBreakdownRow[] }>,
    enabled: connected,
  });

  const overview = overviewQuery.data;
  const series = timeseriesQuery.data ?? [];
  const sources = sourcesQuery.data ?? [];
  const pages = pagesQuery.data ?? [];
  const audience = audienceQuery.data;

  if (statusQuery.isLoading) return <SkeletonCard className="h-64" />;
  if (statusQuery.error) return <ErrorState message={(statusQuery.error as Error).message} onRetry={() => statusQuery.refetch()} />;

  if (!connected) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Website Analytics</h1>
        </div>
        <EmptyState
          title="No GA4 property connected yet"
          description={
            isAdmin
              ? "Grant the service account Viewer access in GA4's Property Access Management, then enter the numeric Property ID below (Admin → Property Settings, not the G-XXXXXXX measurement ID)."
              : "Ask an admin to connect your site's GA4 property."
          }
          action={
            isAdmin ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (propertyIdDraft.trim()) setPropertyMutation.mutate(propertyIdDraft.trim());
                }}
              >
                <Input value={propertyIdDraft} onChange={(e) => setPropertyIdDraft(e.target.value)} placeholder="e.g. 123456789" className="w-40" />
                <Button type="submit" size="sm" loading={setPropertyMutation.isPending}>
                  Connect
                </Button>
              </form>
            ) : undefined
          }
        />
        {setPropertyMutation.error && (
          <p className="text-xs text-error">{(setPropertyMutation.error as Error).message}</p>
        )}
      </div>
    );
  }

  return (
    <DashboardCenterShell
      compact
      title="Website Analytics"
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      onRefresh={() => {
        overviewQuery.refetch();
        timeseriesQuery.refetch();
        sourcesQuery.refetch();
        pagesQuery.refetch();
        audienceQuery.refetch();
      }}
      refreshing={overviewQuery.isFetching || timeseriesQuery.isFetching || sourcesQuery.isFetching || pagesQuery.isFetching || audienceQuery.isFetching}
    >
      {overviewQuery.isLoading && <SkeletonCard className="h-32" />}
      {overviewQuery.error && <ErrorState message={(overviewQuery.error as Error).message} onRetry={() => overviewQuery.refetch()} />}

      {overview && (
        // Icon'd cards with embedded sparklines, not the app's usual flat
        // KpiStrip (Part: Dashboard Center, 2026-10-20, explicit user
        // request — a reference screenshot: "i want the dashboards like
        // this one"). Each sparkline reuses `series`, the SAME per-day rows
        // the big "Traffic over time" chart below is built from, rather
        // than issuing its own request — a tile can never show a trend
        // that disagrees with the detailed chart underneath it. Colors
        // reuse this app's own SERIES tokens, not the reference's palette
        // (standing instruction from earlier in this session).
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCardWithSparkline
            icon={<UsersIcon />}
            label="Total Users"
            value={num(overview.totalUsers)}
            deltaPct={overview.totalUsersDeltaPct}
            color={SERIES[0]}
            sparklineData={series}
            dataKey="totalUsers"
          />
          <StatCardWithSparkline
            icon={<PulseIcon />}
            label="Sessions"
            value={num(overview.sessions)}
            deltaPct={overview.sessionsDeltaPct}
            color={SERIES[1]}
            sparklineData={series}
            dataKey="sessions"
          />
          <StatCardWithSparkline
            icon={<EyeIcon />}
            label="Page Views"
            value={num(overview.pageViews)}
            deltaPct={overview.pageViewsDeltaPct}
            color={SERIES[2]}
            sparklineData={series}
            dataKey="pageViews"
          />
          <StatCardWithSparkline
            icon={<ClockIcon />}
            label="Avg. Session"
            value={avgSessionLabel(overview.avgSessionSeconds)}
            color={SERIES[3]}
            sparklineData={series}
            dataKey="avgSessionSeconds"
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {overview && overview.engagementRate !== undefined && (
          <SectionCard title="Engagement Rate" subtitle="This period">
            <div className="flex flex-col items-center gap-2 py-2">
              <RadialProgress value={overview.engagementRate} displayValue={pct(overview.engagementRate)} label="Engagement Rate" size={188} />
            </div>
          </SectionCard>
        )}

        <div className="lg:col-span-2">
          {series.length > 0 && (
            <ChartWithTable
              title="Traffic over time"
              expandable
              chart={
                <>
                  <Legend items={[
                    { label: "Users", color: SERIES[0] },
                    { label: "Sessions", color: SERIES[1] },
                    { label: "Page Views", color: SERIES[2] },
                  ]} />
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={series}>
                      <defs>
                        {SERIES.slice(0, 3).map((color, i) => (
                          <linearGradient key={color} id={`ga-area-${i}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                            <stop offset="100%" stopColor={color} stopOpacity={0} />
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="date" {...AXIS_PROPS} />
                      <YAxis {...AXIS_PROPS} tickFormatter={formatCompact} />
                      <Tooltip {...TOOLTIP_STYLE} />
                      <Area type="monotone" dataKey="totalUsers" name="Users" stroke={SERIES[0]} fill="url(#ga-area-0)" strokeWidth={2} dot={{ r: 2, fill: SERIES[0], strokeWidth: 0 }} />
                      <Area type="monotone" dataKey="sessions" name="Sessions" stroke={SERIES[1]} fill="url(#ga-area-1)" strokeWidth={2} dot={{ r: 2, fill: SERIES[1], strokeWidth: 0 }} />
                      <Area type="monotone" dataKey="pageViews" name="Page Views" stroke={SERIES[2]} fill="url(#ga-area-2)" strokeWidth={2} dot={{ r: 2, fill: SERIES[2], strokeWidth: 0 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </>
              }
              table={
                <DataTable
                  rowKey={(r) => r.date}
                  rows={series}
                  columns={[
                    { key: "date", header: "Date", render: (r) => r.date, sortValue: (r) => new Date(r.date).getTime() },
                    { key: "totalUsers", header: "Users", render: (r) => num(r.totalUsers), numeric: true, sortValue: (r) => r.totalUsers },
                    { key: "sessions", header: "Sessions", render: (r) => num(r.sessions), numeric: true, sortValue: (r) => r.sessions },
                    { key: "pageViews", header: "Page Views", render: (r) => num(r.pageViews), numeric: true, sortValue: (r) => r.pageViews },
                  ]}
                />
              }
            />
          )}
        </div>
      </div>

      {series.length > 0 && overview && (
        // One card per metric, each a full-size trend (Part: Dashboard
        // Center, 2026-10-20) -- same real `series` rows as the sparklines
        // and the combined chart above, just rendered larger with axes.
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MiniTrendCard
            label="Users over time"
            value={num(overview.totalUsers)}
            deltaPct={overview.totalUsersDeltaPct}
            color={SERIES[0]}
            data={usersTrendData ?? series}
            dataKey="totalUsers"
            xKey="date"
            axisProps={AXIS_PROPS}
            gridProps={GRID_PROPS}
            tooltipProps={TOOLTIP_STYLE}
            duration={usersDuration}
            durationOptions={TREND_DURATION_OPTIONS}
            onDurationChange={setUsersDuration}
            loading={usersTrendQuery.isFetching}
          />
          <MiniTrendCard
            label="Sessions over time"
            value={num(overview.sessions)}
            deltaPct={overview.sessionsDeltaPct}
            color={SERIES[1]}
            data={sessionsTrendData ?? series}
            dataKey="sessions"
            xKey="date"
            axisProps={AXIS_PROPS}
            gridProps={GRID_PROPS}
            tooltipProps={TOOLTIP_STYLE}
            duration={sessionsDuration}
            durationOptions={TREND_DURATION_OPTIONS}
            onDurationChange={setSessionsDuration}
            loading={sessionsTrendQuery.isFetching}
          />
          <MiniTrendCard
            label="Page Views over time"
            value={num(overview.pageViews)}
            deltaPct={overview.pageViewsDeltaPct}
            color={SERIES[2]}
            data={pageViewsTrendData ?? series}
            dataKey="pageViews"
            xKey="date"
            axisProps={AXIS_PROPS}
            gridProps={GRID_PROPS}
            tooltipProps={TOOLTIP_STYLE}
            duration={pageViewsDuration}
            durationOptions={TREND_DURATION_OPTIONS}
            onDurationChange={setPageViewsDuration}
            loading={pageViewsTrendQuery.isFetching}
          />
          <MiniTrendCard
            label="Avg. Session Duration"
            value={avgSessionLabel(overview.avgSessionSeconds)}
            color={SERIES[3]}
            data={avgSessionTrendData ?? series}
            dataKey="avgSessionSeconds"
            xKey="date"
            axisProps={AXIS_PROPS}
            gridProps={GRID_PROPS}
            tooltipProps={TOOLTIP_STYLE}
            duration={avgSessionDurationRange}
            durationOptions={TREND_DURATION_OPTIONS}
            onDurationChange={setAvgSessionDurationRange}
            loading={avgSessionTrendQuery.isFetching}
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {sourcesQuery.isLoading && <SkeletonCard className="h-56" />}
        {sourcesQuery.error && <ErrorState message={(sourcesQuery.error as Error).message} onRetry={() => sourcesQuery.refetch()} />}
        {sources.length > 0 && (
          <SectionCard title="Traffic Sources" subtitle="Sessions by channel, this period">
            <DonutBreakdown data={sources.map((s, i) => ({ label: s.label, value: s.value, color: SERIES[i % SERIES.length] }))} />
          </SectionCard>
        )}

        {audience && audience.devices.length > 0 && (
          <SectionCard title="Devices" subtitle="Sessions by device category, this period">
            <DonutBreakdown data={audience.devices.map((d, i) => ({ label: d.label, value: d.value, color: SERIES[i % SERIES.length] }))} />
          </SectionCard>
        )}
      </div>

      {pages.length > 0 && (
        <SectionCard title="Top Pages" subtitle="Most-viewed pages this period" expandable>
          <DataTable
            rowKey={(r) => r.path}
            rows={pages}
            columns={[
              { key: "path", header: "Page", render: (r) => r.path, sortValue: (r) => r.path },
              { key: "views", header: "Views", render: (r) => num(r.views), numeric: true, sortValue: (r) => r.views },
            ]}
          />
        </SectionCard>
      )}

      {audienceQuery.isLoading && <SkeletonCard className="h-32" />}
      {audienceQuery.error && <ErrorState message={(audienceQuery.error as Error).message} onRetry={() => audienceQuery.refetch()} />}
      {audience && audience.countries.length > 0 && (
        <SectionCard title="Top Countries" subtitle="Sessions by country, this period" expandable>
          <DataTable
            rowKey={(r) => r.label}
            rows={audience.countries}
            columns={[
              { key: "label", header: "Country", render: (r) => r.label, sortValue: (r) => r.label },
              { key: "value", header: "Sessions", render: (r) => num(r.value), numeric: true, sortValue: (r) => r.value },
            ]}
          />
        </SectionCard>
      )}

      {isAdmin && (
        <SectionCard title="Connection" subtitle="Change the connected GA4 property">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (propertyIdDraft.trim()) setPropertyMutation.mutate(propertyIdDraft.trim());
            }}
          >
            <Input
              value={propertyIdDraft || statusQuery.data?.propertyId || ""}
              onChange={(e) => setPropertyIdDraft(e.target.value)}
              placeholder="GA4 Property ID"
              className="w-40"
            />
            <Button type="submit" size="sm" loading={setPropertyMutation.isPending}>
              Update
            </Button>
          </form>
        </SectionCard>
      )}
    </DashboardCenterShell>
  );
}
