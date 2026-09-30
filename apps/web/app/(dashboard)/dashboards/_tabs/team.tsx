"use client";

import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../../../lib/api-client";
import { DashboardCenterShell, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";
import { dashboardRangeToQuery } from "../../../../components/dashboard-center/date-range-bar";
import { num, pct } from "../../../../components/dashboard-center/format";
import { AXIS_PROPS, ChartWithTable, DataTable, GRID_PROPS, SERIES, TOOLTIP_STYLE, formatCompact } from "../../../../components/chart-kit";
import { ErrorState } from "../../../../components/ui/error-state";
import { SkeletonCard } from "../../../../components/ui/skeleton";
import { EmptyState } from "../../../../components/ui/empty-state";

interface TeamRow {
  userId: string;
  name: string;
  leadsAdded: number;
  leadsConverted: number;
  leadsLost: number;
  conversionRate?: number;
  conversationsHandled: number;
  emailsSent: number;
}

export function TeamTab() {
  const [dateRange, setDateRange] = useDashboardDateRange();
  const query = dashboardRangeToQuery(dateRange);

  const teamQuery = useQuery({ queryKey: ["dc-team-performance", query], queryFn: () => api.getDashboardTeamPerformance(query) as Promise<TeamRow[]> });
  const team = teamQuery.data ?? [];

  return (
    <DashboardCenterShell
      compact
      title="Team Performance Dashboard"
      subtitle="Per-user rollup. Email performance is credited to whoever uploaded the lead (Lead.uploadedByUserId) — there's no per-sender field on EmailMessage — a defensible default, not a tracked fact."
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      onRefresh={() => teamQuery.refetch()}
      refreshing={teamQuery.isFetching}
    >
      {teamQuery.isLoading && <SkeletonCard className="h-56" />}
      {teamQuery.error && <ErrorState message={(teamQuery.error as Error).message} onRetry={() => teamQuery.refetch()} />}
      {!teamQuery.isLoading && team.length === 0 && <EmptyState title="No active team members with activity in this period" />}

      {team.length > 0 && (
        <ChartWithTable
          title="Leads added per team member"
          expandable
          chart={
            <ResponsiveContainer width="100%" height={Math.max(220, team.length * 36)}>
              <BarChart data={team} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis type="number" {...AXIS_PROPS} tickFormatter={formatCompact} />
                <YAxis type="category" dataKey="name" {...AXIS_PROPS} width={120} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Bar dataKey="leadsAdded" fill={SERIES[0]} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          }
          table={
            <DataTable
              rowKey={(r) => r.userId}
              rows={team}
              columns={[
                { key: "name", header: "Team member", render: (r) => r.name },
                { key: "leadsAdded", header: "Leads Added", render: (r) => num(r.leadsAdded), numeric: true },
                { key: "leadsConverted", header: "Converted", render: (r) => num(r.leadsConverted), numeric: true },
                { key: "leadsLost", header: "Lost", render: (r) => num(r.leadsLost), numeric: true },
                { key: "conversionRate", header: "Conv. Rate", render: (r) => pct(r.conversionRate), numeric: true },
                { key: "conversationsHandled", header: "Social Convos", render: (r) => num(r.conversationsHandled), numeric: true },
                { key: "emailsSent", header: "Emails Sent", render: (r) => num(r.emailsSent), numeric: true },
              ]}
            />
          }
        />
      )}
    </DashboardCenterShell>
  );
}
