"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../../../lib/api-client";
import { DashboardCenterShell, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";
import { dashboardRangeToQuery } from "../../../../components/dashboard-center/date-range-bar";
import { num, pct, dateTime, titleCase } from "../../../../components/dashboard-center/format";
import { MetricDetail, ComparisonHint } from "../../../../components/dashboard-center/metric-detail";
import { AXIS_PROPS, ChartWithTable, DataTable, GRID_PROPS, SERIES, TOOLTIP_STYLE, formatCompact } from "../../../../components/chart-kit";
import { StatTile } from "../../../../components/chart-kit";
import { ErrorState } from "../../../../components/ui/error-state";
import { SkeletonCard } from "../../../../components/ui/skeleton";
import { Input } from "../../../../components/ui/input";
import { Table, TableHead, TableHeadRow, Th, TableBody, Tr, Td, TableEmptyRow } from "../../../../components/ui/table";
import { Button } from "../../../../components/ui/button";

interface LeadsKpis {
  allTimeTotal: number;
  totalLeads: number;
  previousTotalLeads?: number;
  totalLeadsDeltaPct: number | null;
  qualified: number;
  unqualified: number;
  active: number;
  converted: number;
  lost: number;
  conversionRate?: number;
  duplicates: number;
  withoutOwner: number;
  withoutNiche: number;
  withoutPipeline: number;
}

interface SourceRow {
  source: string;
  count: number;
  percentage?: number;
}

interface NicheRow {
  niche: string;
  total: number;
  qualified: number;
  converted: number;
  conversionRate?: number;
}

interface AuditRow {
  id: string;
  companyName: string;
  email: string | null;
  createdAt: string;
  source: string;
  addedBy: string | null;
  niche: string | null;
  campaign: string | null;
  stage: string;
}

const PAGE_SIZE = 25;

export default function LeadsDashboardPage() {
  const [dateRange, setDateRange] = useDashboardDateRange();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const query = dashboardRangeToQuery(dateRange);

  const kpisQuery = useQuery({
    queryKey: ["dc-leads-kpis", query],
    queryFn: () => api.getDashboardLeadsKpis(query) as Promise<LeadsKpis>,
  });
  const sourcesQuery = useQuery({
    queryKey: ["dc-leads-sources", query],
    queryFn: () => api.getDashboardLeadsSources(query) as Promise<SourceRow[]>,
  });
  const nichesQuery = useQuery({
    queryKey: ["dc-leads-niches", query],
    queryFn: () => api.getDashboardLeadsNiches(query) as Promise<NicheRow[]>,
  });
  const auditQuery = useQuery({
    queryKey: ["dc-leads-audit", query, search, page],
    queryFn: () =>
      api.getDashboardLeadsAudit({ ...query, search, page: String(page), pageSize: String(PAGE_SIZE) }) as Promise<{
        rows: AuditRow[];
        total: number;
        page: number;
        pageSize: number;
      }>,
  });

  const kpis = kpisQuery.data;
  const sources = sourcesQuery.data ?? [];
  const niches = nichesQuery.data ?? [];
  const audit = auditQuery.data;
  const pageCount = Math.max(1, Math.ceil((audit?.total ?? 0) / PAGE_SIZE));

  return (
    <DashboardCenterShell
      title="Leads Dashboard"
      subtitle="Lead volume, source/niche breakdown, addition audit, and per-lead activity timeline."
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      onRefresh={() => {
        kpisQuery.refetch();
        sourcesQuery.refetch();
        nichesQuery.refetch();
        auditQuery.refetch();
      }}
      refreshing={kpisQuery.isFetching || sourcesQuery.isFetching || nichesQuery.isFetching || auditQuery.isFetching}
    >
      {kpisQuery.isLoading && <SkeletonCard className="h-32" />}
      {kpisQuery.error && <ErrorState message={(kpisQuery.error as Error).message} onRetry={() => kpisQuery.refetch()} />}

      {kpis && (
        <>
          {/* Every tile below is scoped to the selected date range, same as
              the Leads by source/niche charts underneath — previously this
              row showed the org-wide all-time total next to charts that only
              summed to the period, which looked like the dashboard was
              counting wrong. All-time total is still shown, but separately
              and clearly labeled. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile
              label="Leads (Selected Period)"
              value={num(kpis.totalLeads)}
              hint={<ComparisonHint deltaPct={kpis.totalLeadsDeltaPct} previousValue={kpis.previousTotalLeads !== undefined ? num(kpis.previousTotalLeads) : undefined} />}
              detail={
                <MetricDetail
                  definition="Leads created within the currently selected date range, matching any owner/niche/campaign/source filter applied."
                  rows={[
                    { label: "Leads in period", value: num(kpis.totalLeads) },
                    {
                      label: "Change vs previous period",
                      value: kpis.totalLeadsDeltaPct !== null ? `${kpis.totalLeadsDeltaPct > 0 ? "+" : ""}${kpis.totalLeadsDeltaPct.toFixed(1)}%` : "—",
                    },
                    { label: "All-time total (any period)", value: num(kpis.allTimeTotal) },
                  ]}
                />
              }
            />
            <StatTile
              label="Qualified"
              value={num(kpis.qualified)}
              hint="Replied or further in the pipeline"
              detail={
                <MetricDetail
                  definition="Leads whose current pipeline stage is Replied, Meeting Booked, Proposal Sent, Negotiation, Won, or Client Onboarding — real engagement occurred. There is no separate tracked 'qualified' field; this is a documented definition over stage data."
                  rows={[
                    { label: "Qualified", value: num(kpis.qualified) },
                    { label: "Unqualified", value: num(kpis.unqualified) },
                    { label: "Total in period", value: num(kpis.totalLeads) },
                    { label: "Share of period", value: pct(kpis.totalLeads ? (kpis.qualified / kpis.totalLeads) * 100 : undefined) },
                  ]}
                />
              }
            />
            <StatTile
              label="Active"
              value={num(kpis.active)}
              detail={
                <MetricDetail
                  definition="Leads in this period not yet converted or lost — still moving through the pipeline."
                  rows={[
                    { label: "Active", value: num(kpis.active) },
                    { label: "Total in period", value: num(kpis.totalLeads) },
                    { label: "Converted", value: num(kpis.converted) },
                    { label: "Lost", value: num(kpis.lost) },
                  ]}
                />
              }
            />
            <StatTile
              label="Converted"
              value={num(kpis.converted)}
              tone="good"
              detail={
                <MetricDetail
                  definition="Leads whose current pipeline stage is Won or Client Onboarding."
                  rows={[
                    { label: "Converted", value: num(kpis.converted) },
                    { label: "Total in period", value: num(kpis.totalLeads) },
                    { label: "Conversion rate", value: pct(kpis.conversionRate) },
                  ]}
                />
              }
            />
            <StatTile
              label="Lost"
              value={num(kpis.lost)}
              tone="bad"
              detail={
                <MetricDetail
                  definition="Leads whose current pipeline stage is Lost."
                  rows={[
                    { label: "Lost", value: num(kpis.lost) },
                    { label: "Total in period", value: num(kpis.totalLeads) },
                  ]}
                />
              }
            />
            <StatTile
              label="Conversion Rate"
              value={pct(kpis.conversionRate)}
              detail={
                <MetricDetail
                  definition="Converted leads divided by total leads in the selected period."
                  rows={[
                    { label: "Converted", value: num(kpis.converted) },
                    { label: "Total in period", value: num(kpis.totalLeads) },
                    { label: "Rate", value: pct(kpis.conversionRate) },
                  ]}
                />
              }
            />
            <StatTile
              label="Possible Duplicates"
              value={num(kpis.duplicates)}
              detail={
                <MetricDetail
                  definition="Leads flagged by the two-tier dedup system (DB unique constraints plus fuzzy name/LinkedIn-slug matching) as possibly duplicating another lead."
                  rows={[{ label: "Flagged as possible duplicate", value: num(kpis.duplicates) }, { label: "Total in period", value: num(kpis.totalLeads) }]}
                />
              }
            />
            <StatTile
              label="Missing Owner"
              value={num(kpis.withoutOwner)}
              hint="No uploadedByUserId"
              detail={
                <MetricDetail
                  definition="Leads with no uploadedByUserId set — typically AI-discovered leads that weren't manually uploaded by a team member."
                  rows={[{ label: "Missing owner", value: num(kpis.withoutOwner) }, { label: "Total in period", value: num(kpis.totalLeads) }]}
                />
              }
            />
            <StatTile
              label="Missing Niche"
              value={num(kpis.withoutNiche)}
              detail={
                <MetricDetail
                  definition="Leads with no filterId — not linked to a real NicheFilter, so they're excluded from the niche breakdown below (shown there as 'Unattributed')."
                  rows={[{ label: "Missing niche", value: num(kpis.withoutNiche) }, { label: "Total in period", value: num(kpis.totalLeads) }]}
                />
              }
            />
            <StatTile
              label="All-Time Total"
              value={num(kpis.allTimeTotal)}
              hint="Every lead ever added, ignoring the date filter"
              detail={
                <MetricDetail
                  definition="Every lead ever added to this organization, regardless of the date range currently selected above."
                  rows={[
                    { label: "All-time total", value: num(kpis.allTimeTotal) },
                    { label: "In selected period", value: num(kpis.totalLeads) },
                    { label: "Missing pipeline state", value: num(kpis.withoutPipeline) },
                  ]}
                />
              }
            />
          </div>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartWithTable
          title="Leads by source"
          subtitle="Where each lead in this period originated"
          expandable
          chart={
            sources.length === 0 ? (
              <p className="py-8 text-center text-xs text-ink/45">No leads in this period.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={sources}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="source" {...AXIS_PROPS} tickFormatter={titleCase} />
                  <YAxis {...AXIS_PROPS} tickFormatter={formatCompact} />
                  <Tooltip {...TOOLTIP_STYLE} labelFormatter={(v) => titleCase(String(v))} />
                  <Bar dataKey="count" fill={SERIES[0]} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )
          }
          table={
            <DataTable
              rowKey={(r) => r.source}
              rows={sources}
              columns={[
                { key: "source", header: "Source", render: (r) => titleCase(r.source) },
                { key: "count", header: "Count", render: (r) => num(r.count), numeric: true },
                { key: "pct", header: "% of total", render: (r) => pct(r.percentage), numeric: true },
              ]}
            />
          }
        />

        <ChartWithTable
          title="Leads by niche"
          subtitle="Real NicheFilter attribution — 'Unattributed' means no filter was linked"
          expandable
          chart={
            niches.length === 0 ? (
              <p className="py-8 text-center text-xs text-ink/45">No leads in this period.</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={niches.slice(0, 8)}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="niche" {...AXIS_PROPS} interval={0} angle={-20} textAnchor="end" height={50} />
                  <YAxis {...AXIS_PROPS} tickFormatter={formatCompact} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Bar dataKey="total" fill={SERIES[1]} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )
          }
          table={
            <DataTable
              rowKey={(r) => r.niche}
              rows={niches}
              columns={[
                { key: "niche", header: "Niche", render: (r) => r.niche },
                { key: "total", header: "Total", render: (r) => num(r.total), numeric: true },
                { key: "qualified", header: "Qualified", render: (r) => num(r.qualified), numeric: true },
                { key: "converted", header: "Converted", render: (r) => num(r.converted), numeric: true },
                { key: "rate", header: "Conv. Rate", render: (r) => pct(r.conversionRate), numeric: true },
              ]}
            />
          }
        />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-tight">Lead addition audit</h2>
          <Input
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder="Search company or email…"
            className="max-w-xs text-xs"
          />
        </div>

        {auditQuery.isLoading && <SkeletonCard className="h-48" />}
        {auditQuery.error && <ErrorState message={(auditQuery.error as Error).message} onRetry={() => auditQuery.refetch()} />}

        {audit && (
          <>
            <Table>
              <TableHead>
                <TableHeadRow>
                  <Th>Added</Th>
                  <Th>Company</Th>
                  <Th>Source</Th>
                  <Th>Added By</Th>
                  <Th>Niche</Th>
                  <Th>Campaign</Th>
                  <Th>Stage</Th>
                </TableHeadRow>
              </TableHead>
              <TableBody>
                {audit.rows.map((r) => (
                  <Tr key={r.id} onClick={() => window.open(`/leads/${r.id}`, "_blank")}>
                    <Td className="whitespace-nowrap text-ink/60">{dateTime(r.createdAt)}</Td>
                    <Td className="font-medium">
                      {r.companyName}
                      {r.email && <span className="text-ink/40"> · {r.email}</span>}
                    </Td>
                    <Td>{titleCase(r.source)}</Td>
                    <Td>{r.addedBy ?? <span className="text-ink/40">Unassigned</span>}</Td>
                    <Td>{r.niche ?? <span className="text-ink/40">—</span>}</Td>
                    <Td>{r.campaign ?? <span className="text-ink/40">—</span>}</Td>
                    <Td>{titleCase(r.stage)}</Td>
                  </Tr>
                ))}
                {audit.rows.length === 0 && <TableEmptyRow colSpan={7}>No leads match this filter.</TableEmptyRow>}
              </TableBody>
            </Table>

            {pageCount > 1 && (
              <div className="flex items-center justify-center gap-3 text-xs text-ink/60">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <span>
                  Page {page} of {pageCount} ({audit.total} leads)
                </span>
                <Button variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </DashboardCenterShell>
  );
}
