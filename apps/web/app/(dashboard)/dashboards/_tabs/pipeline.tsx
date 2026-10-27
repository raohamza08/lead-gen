"use client";

import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../../../lib/api-client";
import { DashboardCenterShell, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";
import { num, pct, minutes, titleCase } from "../../../../components/dashboard-center/format";
import { MetricDetail } from "../../../../components/dashboard-center/metric-detail";
import { AXIS_PROPS, ChartWithTable, DataTable, DonutBreakdown, GRID_PROPS, KpiStrip, SectionCard, SERIES, StatTile, TOOLTIP_STYLE, formatCompact } from "../../../../components/chart-kit";
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

export function PipelineTab() {
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
      compact
      title="Pipeline Dashboard"
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      onRefresh={() => {
        funnelQuery.refetch();
        timingQuery.refetch();
        agingQuery.refetch();
      }}
      refreshing={funnelQuery.isFetching || timingQuery.isFetching || agingQuery.isFetching}
    >
      {funnelQuery.isLoading && <SkeletonCard className="h-32" />}
      {funnelQuery.error && <ErrorState message={(funnelQuery.error as Error).message} onRetry={() => funnelQuery.refetch()} />}

      {funnel && (
        <KpiStrip>
          <StatTile
            label="Total in Pipeline"
            value={num(funnel.total)}
            detail={<MetricDetail definition="Every lead with a PipelineState row, regardless of stage." rows={[{ label: "Total", value: num(funnel.total) }]} />}
          />
          <StatTile
            label="Won"
            value={num(funnel.won)}
            tone="good"
            detail={<MetricDetail definition="Leads currently at the WON stage." rows={[{ label: "Won", value: num(funnel.won) }, { label: "Total in pipeline", value: num(funnel.total) }]} />}
          />
          <StatTile
            label="Lost"
            value={num(funnel.lost)}
            tone="bad"
            detail={<MetricDetail definition="Leads currently at the LOST stage." rows={[{ label: "Lost", value: num(funnel.lost) }, { label: "Total in pipeline", value: num(funnel.total) }]} />}
          />
          <StatTile
            label="Conversion Rate"
            value={pct(funnel.conversionRate)}
            detail={<MetricDetail definition="Won divided by total in pipeline." rows={[{ label: "Won", value: num(funnel.won) }, { label: "Total", value: num(funnel.total) }, { label: "Rate", value: pct(funnel.conversionRate) }]} />}
          />
        </KpiStrip>
      )}

      {funnel && (
        <SectionCard title="Stage funnel" subtitle="Current lead count per pipeline stage" expandable>
          {/* Real-chart pass (Part: Dashboard Center, 2026-10-19) — the
              table below is still the source of truth and stays; the donut
              is the same `funnel.stages` counts, not a separate fetch, so
              it can never disagree with the table next to it. */}
          <DonutBreakdown
            data={funnel.stages.map((s) => ({ label: titleCase(s.stage), value: s.count }))}
            centerValue={num(funnel.total)}
            centerLabel="Total"
          />
          <div className="mt-4">
            <DataTable
              rowKey={(r) => r.stage}
              rows={funnel.stages}
              columns={[
                { key: "stage", header: "Stage", render: (r) => titleCase(r.stage), sortValue: (r) => r.stage },
                { key: "count", header: "Leads", render: (r) => num(r.count), numeric: true, sortValue: (r) => r.count },
                { key: "pct", header: "% of pipeline", render: (r) => pct(r.percentage), numeric: true, sortValue: (r) => r.percentage },
              ]}
            />
          </div>
        </SectionCard>
      )}

      <ChartWithTable
        title="Lead aging"
        subtitle="How long active (non-terminal) leads have sat in their current stage"
        expandable
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
              { key: "label", header: "Age bucket", render: (r) => r.label, sortValue: (r) => r.label },
              { key: "count", header: "Leads", render: (r) => num(r.count), numeric: true, sortValue: (r) => r.count },
            ]}
          />
        }
      />

      {timingQuery.isLoading && <SkeletonCard className="h-32" />}
      {timingQuery.error && <ErrorState message={(timingQuery.error as Error).message} onRetry={() => timingQuery.refetch()} />}
      {!timingQuery.isLoading && timing.length === 0 && (
        <SectionCard
          title="Average time in stage"
        >
          <p className="py-6 text-center text-xs text-ink/45">
            Not enough historical data yet — stage-transition history only started being recorded 2026-09-30.
          </p>
        </SectionCard>
      )}
      {timing.length > 0 && (
        // Real-chart pass, round 2 (Part: Dashboard Center, 2026-10-20,
        // explicit user request — "these are less charts and graphs, I need
        // more"). Only rows with a real avgMinutesInStage go into the chart
        // — a stage with sampleSize>0 but no computed average (filtered
        // separately below) would otherwise plot as a false zero-minute bar.
        <ChartWithTable
          title="Average time in stage"
          expandable
          chart={
            timing.filter((t) => t.avgMinutesInStage !== undefined).length === 0 ? (
              <p className="py-8 text-center text-xs text-ink/45">No stage has a computed average yet.</p>
            ) : (
              <ResponsiveContainer
                width="100%"
                height={Math.max(140, timing.filter((t) => t.avgMinutesInStage !== undefined).length * 32)}
              >
                <BarChart
                  data={timing
                    .filter((t) => t.avgMinutesInStage !== undefined)
                    .map((t) => ({ ...t, stageLabel: titleCase(t.stage) }))
                    .sort((a, b) => (b.avgMinutesInStage ?? 0) - (a.avgMinutesInStage ?? 0))}
                  layout="vertical"
                  margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
                >
                  <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
                  <XAxis type="number" {...AXIS_PROPS} tickFormatter={(v) => minutes(v)} />
                  <YAxis type="category" dataKey="stageLabel" width={130} {...AXIS_PROPS} />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => minutes(v)} />
                  <Bar dataKey="avgMinutesInStage" name="Avg. time" fill={SERIES[1]} radius={[0, 4, 4, 0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            )
          }
          table={
            <DataTable
              rowKey={(r) => r.stage}
              rows={timing}
              columns={[
                { key: "stage", header: "Stage", render: (r) => titleCase(r.stage), sortValue: (r) => r.stage },
                { key: "avgMinutesInStage", header: "Avg. Time in Stage", render: (r) => minutes(r.avgMinutesInStage), numeric: true, sortValue: (r) => r.avgMinutesInStage },
                { key: "sampleSize", header: "Sample Size", render: (r) => num(r.sampleSize), numeric: true, sortValue: (r) => r.sampleSize },
              ]}
            />
          }
        />
      )}
    </DashboardCenterShell>
  );
}
