"use client";

import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../../../lib/api-client";
import { DashboardCenterShell, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";
import { dashboardRangeToQuery } from "../../../../components/dashboard-center/date-range-bar";
import { num, pct, dateTime, titleCase } from "../../../../components/dashboard-center/format";
import { AXIS_PROPS, ChartWithTable, DataTable, GRID_PROPS, SectionCard, SERIES, StatTile, TOOLTIP_STYLE, formatCompact } from "../../../../components/chart-kit";
import { ErrorState } from "../../../../components/ui/error-state";
import { SkeletonCard } from "../../../../components/ui/skeleton";
import { EmptyState } from "../../../../components/ui/empty-state";

interface Performance {
  queued: number;
  failed: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  spamComplaints: number;
  unsubscribed: number;
  blocked: number;
  deliveryRate: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
}

interface EmailKpis {
  totalCampaigns: number;
  activeCampaigns: number;
  performance: Performance;
  deltas: { sent: number | null; openRate: number | null; replyRate: number | null; bounced: number | null; unsubscribed: number | null } | null;
}

interface QueueRow {
  status: string;
  count: number;
}

interface SessionRow {
  id: string;
  status: string;
  totalLeads: number;
  successful: number;
  failed: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface StepPerformance extends Performance {
  step: number;
}

interface FunnelReport {
  overall: Performance;
  bySequenceStep: StepPerformance[];
}

interface TimeseriesPoint {
  date: string;
  sent: number;
  opened: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
}

function deltaHint(pctVal: number | null | undefined): string | undefined {
  if (pctVal === null || pctVal === undefined) return undefined;
  return `${pctVal > 0 ? "↑" : "↓"} ${Math.abs(pctVal).toFixed(1)}% vs previous period`;
}

export default function EmailDashboardPage() {
  const [dateRange, setDateRange] = useDashboardDateRange();
  const query = dashboardRangeToQuery(dateRange);

  const kpisQuery = useQuery({ queryKey: ["dc-email-kpis", query], queryFn: () => api.getDashboardEmailKpis(query) as Promise<EmailKpis> });
  const queueQuery = useQuery({ queryKey: ["dc-email-queue"], queryFn: () => api.getDashboardEmailQueue() as Promise<QueueRow[]> });
  const sessionsQuery = useQuery({ queryKey: ["dc-email-sessions"], queryFn: () => api.getDashboardEmailSessions() as Promise<SessionRow[]> });
  const funnelQuery = useQuery({ queryKey: ["dc-email-funnel"], queryFn: () => api.getDashboardEmailStageFunnel() as Promise<FunnelReport> });
  const timeseriesQuery = useQuery({
    queryKey: ["dc-email-timeseries", query],
    queryFn: () => api.getDashboardEmailTimeseries(query) as Promise<TimeseriesPoint[]>,
  });

  const kpis = kpisQuery.data;
  const queue = queueQuery.data ?? [];
  const sessions = sessionsQuery.data ?? [];
  const funnel = funnelQuery.data;
  const series = timeseriesQuery.data ?? [];

  return (
    <DashboardCenterShell
      title="Email Campaign Dashboard"
      subtitle="Sending funnel, queue health, sequence steps, and response timing — sourced from EmailMessage/EmailEvent."
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      onRefresh={() => {
        kpisQuery.refetch();
        queueQuery.refetch();
        sessionsQuery.refetch();
        funnelQuery.refetch();
        timeseriesQuery.refetch();
      }}
    >
      {kpisQuery.isLoading && <SkeletonCard className="h-32" />}
      {kpisQuery.error && <ErrorState message={(kpisQuery.error as Error).message} onRetry={() => kpisQuery.refetch()} />}

      {kpis && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatTile label="Campaigns" value={num(kpis.totalCampaigns)} hint={`${kpis.activeCampaigns} active`} />
          <StatTile label="Sent" value={num(kpis.performance.sent)} hint={deltaHint(kpis.deltas?.sent)} />
          <StatTile label="Delivery Rate" value={pct(kpis.performance.deliveryRate)} />
          <StatTile label="Open Rate" value={pct(kpis.performance.openRate)} hint={deltaHint(kpis.deltas?.openRate)} />
          <StatTile label="Click Rate" value={pct(kpis.performance.clickRate)} />
          <StatTile label="Reply Rate" value={pct(kpis.performance.replyRate)} hint={deltaHint(kpis.deltas?.replyRate)} />
          <StatTile label="Bounced" value={num(kpis.performance.bounced)} tone="bad" hint={deltaHint(kpis.deltas?.bounced)} />
          <StatTile label="Unsubscribed" value={num(kpis.performance.unsubscribed)} hint={deltaHint(kpis.deltas?.unsubscribed)} />
          <StatTile label="Spam Complaints" value={num(kpis.performance.spamComplaints)} tone="bad" />
          <StatTile label="Failed" value={num(kpis.performance.failed)} tone="bad" />
        </div>
      )}

      {series.length > 0 && (
        <ChartWithTable
          title="Send activity over time"
          chart={
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={series}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="date" {...AXIS_PROPS} />
                <YAxis {...AXIS_PROPS} tickFormatter={formatCompact} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Line type="monotone" dataKey="sent" stroke={SERIES[0]} dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="opened" stroke={SERIES[1]} dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="replied" stroke={SERIES[2]} dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="bounced" stroke={SERIES[3]} dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          }
          table={
            <DataTable
              rowKey={(r) => r.date}
              rows={series}
              columns={[
                { key: "date", header: "Date", render: (r) => r.date },
                { key: "sent", header: "Sent", render: (r) => num(r.sent), numeric: true },
                { key: "opened", header: "Opened", render: (r) => num(r.opened), numeric: true },
                { key: "replied", header: "Replied", render: (r) => num(r.replied), numeric: true },
                { key: "bounced", header: "Bounced", render: (r) => num(r.bounced), numeric: true },
                { key: "unsubscribed", header: "Unsubscribed", render: (r) => num(r.unsubscribed), numeric: true },
              ]}
            />
          }
        />
      )}

      {funnel && funnel.bySequenceStep.length > 0 && (
        <SectionCard title="Stage-to-stage funnel" subtitle="Performance per sequence step (1-5), all-time">
          <DataTable
            rowKey={(r) => String(r.step)}
            rows={funnel.bySequenceStep}
            columns={[
              { key: "step", header: "Step", render: (r) => `Email ${r.step}` },
              { key: "sent", header: "Sent", render: (r) => num(r.sent), numeric: true },
              { key: "delivered", header: "Delivered", render: (r) => num(r.delivered), numeric: true },
              { key: "opened", header: "Opened", render: (r) => num(r.opened), numeric: true },
              { key: "openRate", header: "Open Rate", render: (r) => pct(r.openRate), numeric: true },
              { key: "replied", header: "Replied", render: (r) => num(r.replied), numeric: true },
              { key: "replyRate", header: "Reply Rate", render: (r) => pct(r.replyRate), numeric: true },
            ]}
          />
        </SectionCard>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Queue snapshot" subtitle="Live — how many messages sit in each state right now">
          {queue.length === 0 ? (
            <EmptyState title="Queue is empty" />
          ) : (
            <DataTable
              rowKey={(r) => r.status}
              rows={queue}
              columns={[
                { key: "status", header: "Status", render: (r) => titleCase(r.status) },
                { key: "count", header: "Count", render: (r) => num(r.count), numeric: true },
              ]}
            />
          )}
        </SectionCard>

        <SectionCard title="Recent sending sessions">
          {sessions.length === 0 ? (
            <EmptyState title="No sending sessions yet" />
          ) : (
            <DataTable
              rowKey={(r) => r.id}
              rows={sessions}
              columns={[
                { key: "createdAt", header: "Started", render: (r) => dateTime(r.createdAt) },
                { key: "status", header: "Status", render: (r) => titleCase(r.status) },
                { key: "totalLeads", header: "Leads", render: (r) => num(r.totalLeads), numeric: true },
                { key: "successful", header: "Sent OK", render: (r) => num(r.successful), numeric: true },
                { key: "failed", header: "Failed", render: (r) => num(r.failed), numeric: true },
              ]}
            />
          )}
        </SectionCard>
      </div>
    </DashboardCenterShell>
  );
}
