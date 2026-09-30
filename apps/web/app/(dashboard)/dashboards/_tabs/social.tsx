"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { DashboardCenterShell, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";
import { dashboardRangeToQuery } from "../../../../components/dashboard-center/date-range-bar";
import { num, pct, minutes, titleCase } from "../../../../components/dashboard-center/format";
import { MetricDetail, ComparisonHint } from "../../../../components/dashboard-center/metric-detail";
import { DataTable, SectionCard, StatTile } from "../../../../components/chart-kit";
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
      subtitle="Conversation volume, response times, and per-platform breakdown across connected social accounts."
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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

      <SectionCard title="By platform" subtitle="Per connected account, this period" expandable>
        {platformsQuery.isLoading && <SkeletonCard className="h-32" />}
        {platformsQuery.error && <ErrorState message={(platformsQuery.error as Error).message} onRetry={() => platformsQuery.refetch()} />}
        {!platformsQuery.isLoading && platforms.length === 0 && <EmptyState title="No social accounts connected" />}
        {platforms.length > 0 && (
          <DataTable
            rowKey={(r) => r.accountId}
            rows={platforms}
            columns={[
              { key: "platform", header: "Platform", render: (r) => titleCase(r.platform) },
              { key: "username", header: "Account", render: (r) => r.username },
              { key: "conversations", header: "Total Conv.", render: (r) => num(r.conversations), numeric: true },
              { key: "newConversations", header: "New", render: (r) => num(r.newConversations), numeric: true },
              { key: "unread", header: "Unread", render: (r) => num(r.unread), numeric: true },
              { key: "messagesIn", header: "In", render: (r) => num(r.messagesIn), numeric: true },
              { key: "messagesOut", header: "Out", render: (r) => num(r.messagesOut), numeric: true },
            ]}
          />
        )}
      </SectionCard>

      <SectionCard title="Team response performance" subtitle="Only conversations with a real assignedToUserId" expandable>
        {teamQuery.isLoading && <SkeletonCard className="h-32" />}
        {teamQuery.error && <ErrorState message={(teamQuery.error as Error).message} onRetry={() => teamQuery.refetch()} />}
        {!teamQuery.isLoading && team.length === 0 && <EmptyState title="No assigned conversations in this period" />}
        {team.length > 0 && (
          <DataTable
            rowKey={(r) => r.userId}
            rows={team}
            columns={[
              { key: "name", header: "Team member", render: (r) => r.name },
              { key: "conversationsHandled", header: "Conversations", render: (r) => num(r.conversationsHandled), numeric: true },
              { key: "avgResponseMinutes", header: "Avg. Response Time", render: (r) => minutes(r.avgResponseMinutes), numeric: true },
            ]}
          />
        )}
      </SectionCard>
    </DashboardCenterShell>
  );
}
