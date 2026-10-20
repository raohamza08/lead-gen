"use client";

import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../../../lib/api-client";
import { DashboardCenterShell, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";
import { dashboardRangeToQuery } from "../../../../components/dashboard-center/date-range-bar";
import { num, pct } from "../../../../components/dashboard-center/format";
import { AXIS_PROPS, ChartWithTable, DataTable, GRID_PROPS, SINGLE_SERIES, TOOLTIP_STYLE, formatCompact } from "../../../../components/chart-kit";
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
        // Changed from "Leads added per team member" to a general activity
        // ranking (Part: Dashboard Center, 2026-10-20, explicit user
        // request — "change the table from leads per user, to activity per
        // user, means the more a person uses the platform, it will be shown
        // there"). activityScore sums every real per-user action this page
        // already fetches across modules (leads added, social conversations
        // handled, emails sent) rather than leads alone, so someone who's
        // heavily active in the inbox/outreach but adds few leads directly
        // still ranks near the top. A single ranking bar, sorted descending
        // — same "who ranks" convention as Social's "By platform" and
        // Upwork's "By submitter" charts, not a multi-series breakdown.
        <ChartWithTable
          title="Activity per team member"
          subtitle="Leads added + social conversations handled + emails sent, this period — a usage ranking, not a performance judgment"
          expandable
          chart={
            <ResponsiveContainer width="100%" height={Math.max(220, team.length * 40)}>
              <BarChart
                data={[...team]
                  .map((r) => ({ ...r, activityScore: r.leadsAdded + r.conversationsHandled + r.emailsSent }))
                  .sort((a, b) => b.activityScore - a.activityScore)}
                layout="vertical"
                margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
              >
                <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
                <XAxis type="number" allowDecimals={false} {...AXIS_PROPS} tickFormatter={formatCompact} />
                <YAxis type="category" dataKey="name" width={130} {...AXIS_PROPS} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Bar dataKey="activityScore" name="Activity" fill={SINGLE_SERIES} radius={[0, 4, 4, 0]} maxBarSize={22} />
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
