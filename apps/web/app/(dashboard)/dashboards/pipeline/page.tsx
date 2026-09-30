"use client";

import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../../../lib/api-client";
import { DashboardCenterShell, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";
import { num, pct, minutes, titleCase } from "../../../../components/dashboard-center/format";
import { AXIS_PROPS, ChartWithTable, DataTable, GRID_PROPS, SectionCard, SERIES, StatTile, TOOLTIP_STYLE, formatCompact } from "../../../../components/chart-kit";
import { ErrorState } from "../../../../components/ui/error-state";
import { SkeletonCard } from "../../../../components/ui/skeleton";

interface FunnelStage {
  stage: string;
  count: number;
  percentage?: number;
}

interface Funnel {
  total: number;
  won: number;
  lost: number;
  conversionRate?: number;
  stages: FunnelStage[];
}

interface StageTiming {
  stage: string;
  sampleSize: number;
  avgMinutesInStage?: number;
}

interface AgingBucket {
  label: string;
  count: number;
}

export default function PipelineDashboardPage() {
  // Pipeline endpoints are all-time snapshots, not date-ranged (current
  // funnel state / cumulative stage-timing history) — the shared date-range
  // bar is still shown for chrome consistency with every other Dashboard
  // Center page, even though it doesn't affect these particular queries.
  const [dateRange, setDateRange] = useDashboardDateRange();

  const funnelQuery = useQuery({ queryKey: ["dc-pipeline-funnel"], queryFn: () => api.getDashboardPipelineFunnel() as Promise<Funnel> });
  const timingQuery = useQuery({ queryKey: ["dc-pipeline-timing"], queryFn: () => api.getDashboardPipelineStageTiming() as Promise<StageTiming[]> });
  const agingQuery = useQuery({ queryKey: ["dc-pipeline-aging"], queryFn: () => api.getDashboardPipelineAging() as Promise<AgingBucket[]> });

  const funnel = funnelQuery.data;
  const timing = (timingQuery.data ?? []).filter((t) => t.sampleSize > 0 || t.avgMinutesInStage !== undefined);
  const aging = agingQuery.data ?? [];

  return (
    <DashboardCenterShell
      title="Pipeline Dashboard"
      subtitle="Stage funnel, average dwell time per stage, and how long active leads have been sitting in their current stage."
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      onRefresh={() => {
        funnelQuery.refetch();
        timingQuery.refetch();
        agingQuery.refetch();
      }}
    >
      {funnelQuery.isLoading && <SkeletonCard className="h-32" />}
      {funnelQuery.error && <ErrorState message={(funnelQuery.error as Error).message} onRetry={() => funnelQuery.refetch()} />}

      {funnel && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Total in Pipeline" value={num(funnel.total)} />
          <StatTile label="Won" value={num(funnel.won)} tone="good" />
          <StatTile label="Lost" value={num(funnel.lost)} tone="bad" />
          <StatTile label="Conversion Rate" value={pct(funnel.conversionRate)} />
        </div>
      )}

      {funnel && (
        <SectionCard title="Stage funnel" subtitle="Current lead count per pipeline stage">
          <DataTable
            rowKey={(r) => r.stage}
            rows={funnel.stages}
            columns={[
              { key: "stage", header: "Stage", render: (r) => titleCase(r.stage) },
              { key: "count", header: "Leads", render: (r) => num(r.count), numeric: true },
              { key: "pct", header: "% of pipeline", render: (r) => pct(r.percentage), numeric: true },
            ]}
          />
        </SectionCard>
      )}

      <ChartWithTable
        title="Lead aging"
        subtitle="How long active (non-terminal) leads have sat in their current stage"
        chart={
          agingQuery.isLoading ? (
            <SkeletonCard className="h-56" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={aging}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" {...AXIS_PROPS} />
                <YAxis {...AXIS_PROPS} tickFormatter={formatCompact} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Bar dataKey="count" fill={SERIES[0]} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )
        }
        table={
          <DataTable
            rowKey={(r) => r.label}
            rows={aging}
            columns={[
              { key: "label", header: "Age bucket", render: (r) => r.label },
              { key: "count", header: "Leads", render: (r) => num(r.count), numeric: true },
            ]}
          />
        }
      />

      <SectionCard
        title="Average time in stage"
        subtitle="Computed from LeadStageHistory, tracked only since 2026-09-30 — stages with a small sample size are shown as-is rather than hidden, so the limited history is visible"
      >
        {timingQuery.isLoading && <SkeletonCard className="h-32" />}
        {timingQuery.error && <ErrorState message={(timingQuery.error as Error).message} onRetry={() => timingQuery.refetch()} />}
        {!timingQuery.isLoading && timing.length === 0 && (
          <p className="py-6 text-center text-xs text-ink/45">
            Not enough historical data yet — stage-transition history only started being recorded 2026-09-30.
          </p>
        )}
        {timing.length > 0 && (
          <DataTable
            rowKey={(r) => r.stage}
            rows={timing}
            columns={[
              { key: "stage", header: "Stage", render: (r) => titleCase(r.stage) },
              { key: "avgMinutesInStage", header: "Avg. Time in Stage", render: (r) => minutes(r.avgMinutesInStage), numeric: true },
              { key: "sampleSize", header: "Sample Size", render: (r) => num(r.sampleSize), numeric: true },
            ]}
          />
        )}
      </SectionCard>
    </DashboardCenterShell>
  );
}
