"use client";

import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../../../lib/api-client";
import { DashboardCenterShell, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";
import { dashboardRangeToQuery } from "../../../../components/dashboard-center/date-range-bar";
import { num, pct, minutes, titleCase } from "../../../../components/dashboard-center/format";
import { MetricDetail, ComparisonHint } from "../../../../components/dashboard-center/metric-detail";
import { AXIS_PROPS, ChartWithTable, DataTable, DonutBreakdown, GRID_PROPS, KpiStrip, RadialProgress, RadialStrip, SectionCard, SINGLE_SERIES, StatTile, TOOLTIP_STYLE } from "../../../../components/chart-kit";
import { ErrorState } from "../../../../components/ui/error-state";
import { SkeletonCard } from "../../../../components/ui/skeleton";
import { EmptyState } from "../../../../components/ui/empty-state";

interface SocialKpis {
  totalConversations: number;
  previousTotalConversations?: number;
  totalConversationsDeltaPct: number | null;
  unreadConversations: number;
  repliedConversations: number;
  pendingConversations: number;
  responseRate?: number;
  avgResponseMinutes?: number;
  leadConversionAvailable: boolean;
}

interface PlatformRow {
  accountId: string;
  platform: string;
  username: string;
  conversations: number;
  newConversations: number;
  unread: number;
  messagesIn: number;
  messagesOut: number;
}

interface TeamRow {
  userId: string;
  name: string;
  conversationsHandled: number;
  avgResponseMinutes?: number;
}

export function SocialTab() {
  const [dateRange, setDateRange] = useDashboardDateRange();
  const query = dashboardRangeToQuery(dateRange);

  const kpisQuery = useQuery({ queryKey: ["dc-social-kpis", query], queryFn: () => api.getDashboardSocialKpis(query) as Promise<SocialKpis> });
  const platformsQuery = useQuery({
    queryKey: ["dc-social-platforms", query],
    queryFn: () => api.getDashboardSocialPlatforms(query) as Promise<PlatformRow[]>,
  });
  const teamQuery = useQuery({ queryKey: ["dc-social-team", query], queryFn: () => api.getDashboardSocialTeam(query) as Promise<TeamRow[]> });

  const kpis = kpisQuery.data;
  const platforms = platformsQuery.data ?? [];
  const team = teamQuery.data ?? [];

  return (
    <DashboardCenterShell
      compact
      title="Social Inbox Dashboard"
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      onRefresh={() => {
        kpisQuery.refetch();
        platformsQuery.refetch();
        teamQuery.refetch();
      }}
      refreshing={kpisQuery.isFetching || platformsQuery.isFetching || teamQuery.isFetching}
    >
      {kpisQuery.isLoading && <SkeletonCard className="h-32" />}
      {kpisQuery.error && <ErrorState message={(kpisQuery.error as Error).message} onRetry={() => kpisQuery.refetch()} />}

      {kpis && (
        <>
          <KpiStrip>
            <StatTile
              label="Conversations"
              value={num(kpis.totalConversations)}
              hint={<ComparisonHint deltaPct={kpis.totalConversationsDeltaPct} previousValue={kpis.previousTotalConversations !== undefined ? num(kpis.previousTotalConversations) : undefined} />}
              detail={<MetricDetail definition="Social conversations with activity in the selected period, across every connected account." rows={[{ label: "Conversations", value: num(kpis.totalConversations) }]} />}
            />
            <StatTile
              label="Unread"
              value={num(kpis.unreadConversations)}
              detail={<MetricDetail definition="Conversations with an unread count greater than zero." rows={[{ label: "Unread", value: num(kpis.unreadConversations) }, { label: "Total", value: num(kpis.totalConversations) }]} />}
            />
            <StatTile
              label="Replied (Closed)"
              value={num(kpis.repliedConversations)}
              detail={<MetricDetail definition="Conversations with status CLOSED — the closest real proxy for 'handled' in this schema; there's no distinct 'replied' status." rows={[{ label: "Closed", value: num(kpis.repliedConversations) }, { label: "Total", value: num(kpis.totalConversations) }]} />}
            />
            <StatTile
              label="Pending"
              value={num(kpis.pendingConversations)}
              detail={<MetricDetail definition="Conversations with status OPEN or PENDING." rows={[{ label: "Pending", value: num(kpis.pendingConversations) }, { label: "Total", value: num(kpis.totalConversations) }]} />}
            />
            <StatTile
              label="Response Rate"
              value={pct(kpis.responseRate)}
              detail={<MetricDetail definition="Conversations with a computed first-response time divided by every conversation checked (sampled up to 500)." rows={[{ label: "Rate", value: pct(kpis.responseRate) }]} />}
            />
            <StatTile
              label="Avg. Response Time"
              value={minutes(kpis.avgResponseMinutes)}
              detail={<MetricDetail definition="Average time from the first inbound message to the first outbound reply after it, per conversation — computed on the fly, not pre-aggregated." rows={[{ label: "Average", value: minutes(kpis.avgResponseMinutes) }]} />}
            />
          </KpiStrip>

          {/* Real-chart pass, round 2 (Part: Dashboard Center, 2026-10-20,
              explicit user request — "these are less charts and graphs, I
              need more"). Replied (CLOSED) and Pending (OPEN/PENDING) are
              the only two conversation statuses this schema has (per the
              KpiStrip's own MetricDetail text above), so they exhaust
              totalConversations exactly -- safe as a two-slice donut. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Response Rate">
              <RadialStrip>
                <RadialProgress value={kpis.responseRate ?? 0} displayValue={pct(kpis.responseRate)} label="Response Rate" />
              </RadialStrip>
            </SectionCard>
            <SectionCard title="Conversation Status">
              <DonutBreakdown
                data={[
                  { label: "Replied (Closed)", value: kpis.repliedConversations, color: "rgb(var(--good-rgb))" },
                  { label: "Pending", value: kpis.pendingConversations, color: "var(--series-4)" },
                ]}
                centerValue={num(kpis.totalConversations)}
                centerLabel="Total"
              />
            </SectionCard>
          </div>

          {!kpis.leadConversionAvailable && (
            <div className="card px-4 py-3 text-xs text-ink/55">
              <span className="font-medium text-ink/70">Message → Lead → Client funnel: data unavailable.</span> No social
              conversation or comment in this schema links to a CRM Lead record — this is a deliberate later-phase decision,
              not a bug, so this funnel is not fabricated here.
            </div>
          )}
        </>
      )}

      {platformsQuery.isLoading && <SkeletonCard className="h-32" />}
      {platformsQuery.error && <ErrorState message={(platformsQuery.error as Error).message} onRetry={() => platformsQuery.refetch()} />}
      {!platformsQuery.isLoading && platforms.length === 0 && (
        <SectionCard title="By platform" subtitle="Per connected account, this period">
          <EmptyState title="No social accounts connected" />
        </SectionCard>
      )}
      {platforms.length > 0 && (
        // Real data this card already fetched, previously table-only (Part:
        // premium dark theme pass v4, 2026-10-19, explicit user request —
        // "add some graphs... represent the data more better"). A ranking
        // question ("which account carries the most conversation volume?")
        // gets a sorted horizontal bar, one hue, matching taste-skill's
        // "who ranks" chart convention — not a second metric layered on,
        // which would need a legend for what's otherwise a one-glance chart.
        <ChartWithTable
          title="By platform"
          subtitle="Per connected account, this period"
          expandable
          chart={
            <ResponsiveContainer width="100%" height={Math.max(140, platforms.length * 40)}>
              <BarChart
                data={[...platforms].sort((a, b) => b.conversations - a.conversations)}
                layout="vertical"
                margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
              >
                <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
                <XAxis type="number" allowDecimals={false} {...AXIS_PROPS} />
                <YAxis type="category" dataKey="username" width={140} {...AXIS_PROPS} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Bar dataKey="conversations" name="Conversations" fill={SINGLE_SERIES} radius={[0, 4, 4, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          }
          table={
            <DataTable
              rowKey={(r) => r.accountId}
              rows={platforms}
              columns={[
                { key: "platform", header: "Platform", render: (r) => titleCase(r.platform), sortValue: (r) => r.platform },
                { key: "username", header: "Account", render: (r) => r.username, sortValue: (r) => r.username },
                { key: "conversations", header: "Total Conv.", render: (r) => num(r.conversations), numeric: true, sortValue: (r) => r.conversations },
                { key: "newConversations", header: "New", render: (r) => num(r.newConversations), numeric: true, sortValue: (r) => r.newConversations },
                { key: "unread", header: "Unread", render: (r) => num(r.unread), numeric: true, sortValue: (r) => r.unread },
                { key: "messagesIn", header: "In", render: (r) => num(r.messagesIn), numeric: true, sortValue: (r) => r.messagesIn },
                { key: "messagesOut", header: "Out", render: (r) => num(r.messagesOut), numeric: true, sortValue: (r) => r.messagesOut },
              ]}
            />
          }
        />
      )}

      <SectionCard title="Team response performance" subtitle="Only conversations with a real assignedToUserId" expandable>
        {teamQuery.isLoading && <SkeletonCard className="h-32" />}
        {teamQuery.error && <ErrorState message={(teamQuery.error as Error).message} onRetry={() => teamQuery.refetch()} />}
        {!teamQuery.isLoading && team.length === 0 && <EmptyState title="No assigned conversations in this period" />}
        {team.length > 0 && (
          <DataTable
            rowKey={(r) => r.userId}
            rows={team}
            columns={[
              { key: "name", header: "Team member", render: (r) => r.name, sortValue: (r) => r.name },
              { key: "conversationsHandled", header: "Conversations", render: (r) => num(r.conversationsHandled), numeric: true, sortValue: (r) => r.conversationsHandled },
              { key: "avgResponseMinutes", header: "Avg. Response Time", render: (r) => minutes(r.avgResponseMinutes), numeric: true, sortValue: (r) => r.avgResponseMinutes },
            ]}
          />
        )}
      </SectionCard>
    </DashboardCenterShell>
  );
}
