"use client";

import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../../../lib/api-client";
import { DashboardCenterShell, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";
import { dashboardRangeToQuery } from "../../../../components/dashboard-center/date-range-bar";
import { num, pct, dateTime, titleCase } from "../../../../components/dashboard-center/format";
import { MetricDetail, ComparisonHint } from "../../../../components/dashboard-center/metric-detail";
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
  previousPerformance?: Performance;
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
      refreshing={kpisQuery.isFetching || queueQuery.isFetching || sessionsQuery.isFetching || funnelQuery.isFetching || timeseriesQuery.isFetching}
    >
      {kpisQuery.isLoading && <SkeletonCard className="h-32" />}
      {kpisQuery.error && <ErrorState message={(kpisQuery.error as Error).message} onRetry={() => kpisQuery.refetch()} />}

      {kpis && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatTile
            label="Campaigns"
            value={num(kpis.totalCampaigns)}
            hint={`${kpis.activeCampaigns} active`}
            detail={
              <MetricDetail
                definition="Every campaign in the org, and how many are currently active."
                rows={[
                  { label: "Total campaigns", value: num(kpis.totalCampaigns) },
                  { label: "Active", value: num(kpis.activeCampaigns) },
                ]}
              />
            }
          />
          <StatTile
            label="Sent"
            value={num(kpis.performance.sent)}
            hint={<ComparisonHint deltaPct={kpis.deltas?.sent ?? null} previousValue={kpis.previousPerformance ? num(kpis.previousPerformance.sent) : undefined} />}
            detail={
              <MetricDetail
                definition="Messages with a SENT event in the selected period."
                rows={[
                  { label: "Sent", value: num(kpis.performance.sent) },
                  { label: "Delivered", value: num(kpis.performance.delivered) },
                  { label: "Failed", value: num(kpis.performance.failed) },
                  { label: "Still queued", value: num(kpis.performance.queued) },
                ]}
              />
            }
          />
          <StatTile
            label="Delivery Rate"
            value={pct(kpis.performance.deliveryRate)}
            detail={
              <MetricDetail
                definition="Delivered divided by sent."
                rows={[
                  { label: "Delivered", value: num(kpis.performance.delivered) },
                  { label: "Sent", value: num(kpis.performance.sent) },
                  { label: "Rate", value: pct(kpis.performance.deliveryRate) },
                ]}
              />
            }
          />
          <StatTile
            label="Open Rate"
            value={pct(kpis.performance.openRate)}
            hint={<ComparisonHint deltaPct={kpis.deltas?.openRate ?? null} previousValue={kpis.previousPerformance ? pct(kpis.previousPerformance.openRate) : undefined} />}
            detail={
              <MetricDetail
                definition="Verified opens (3-minute prefetch-safe verification) divided by delivered (or sent, where delivery tracking doesn't exist)."
                rows={[
                  { label: "Opened (verified)", value: num(kpis.performance.opened) },
                  { label: "Delivered", value: num(kpis.performance.delivered) },
                  { label: "Rate", value: pct(kpis.performance.openRate) },
                ]}
              />
            }
          />
          <StatTile
            label="Click Rate"
            value={pct(kpis.performance.clickRate)}
            detail={
              <MetricDetail
                definition="Clicked divided by delivered (or sent)."
                rows={[
                  { label: "Clicked", value: num(kpis.performance.clicked) },
                  { label: "Rate", value: pct(kpis.performance.clickRate) },
                ]}
              />
            }
          />
          <StatTile
            label="Reply Rate"
            value={pct(kpis.performance.replyRate)}
            hint={<ComparisonHint deltaPct={kpis.deltas?.replyRate ?? null} previousValue={kpis.previousPerformance ? pct(kpis.previousPerformance.replyRate) : undefined} />}
            detail={
              <MetricDetail
                definition="Replied divided by delivered (or sent)."
                rows={[
                  { label: "Replied", value: num(kpis.performance.replied) },
                  { label: "Rate", value: pct(kpis.performance.replyRate) },
                ]}
              />
            }
          />
          <StatTile
            label="Bounced"
            value={num(kpis.performance.bounced)}
            tone="bad"
            hint={<ComparisonHint deltaPct={kpis.deltas?.bounced ?? null} previousValue={kpis.previousPerformance ? num(kpis.previousPerformance.bounced) : undefined} direction="lower-better" />}
            detail={
              <MetricDetail
                definition="Messages with a BOUNCED event in the selected period."
                rows={[
                  { label: "Bounced", value: num(kpis.performance.bounced) },
                  { label: "Sent", value: num(kpis.performance.sent) },
                ]}
              />
            }
          />
          <StatTile
            label="Unsubscribed"
            value={num(kpis.performance.unsubscribed)}
            hint={<ComparisonHint deltaPct={kpis.deltas?.unsubscribed ?? null} previousValue={kpis.previousPerformance ? num(kpis.previousPerformance.unsubscribed) : undefined} direction="lower-better" />}
            detail={
              <MetricDetail
                definition="Messages with an UNSUBSCRIBED event in the selected period."
                rows={[{ label: "Unsubscribed", value: num(kpis.performance.unsubscribed) }]}
              />
            }
          />
          <StatTile
            label="Spam Complaints"
            value={num(kpis.performance.spamComplaints)}
            tone="bad"
            detail={
              <MetricDetail
                definition="Messages with a SPAM_COMPLAINT event in the selected period."
                rows={[{ label: "Spam complaints", value: num(kpis.performance.spamComplaints) }]}
              />
            }
          />
          <StatTile
            label="Failed"
            value={num(kpis.performance.failed)}
            tone="bad"
            detail={
              <MetricDetail
                definition="Messages that failed to send (status FAILED), including a message-status count in addition to any FAILED event."
                rows={[{ label: "Failed", value: num(kpis.performance.failed) }]}
              />
            }
          />
        </div>
      )}

      {series.length > 0 && (
        <ChartWithTable
          title="Send activity over time"
          expandable
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
        <SectionCard title="Stage-to-stage funnel" subtitle="Performance per sequence step (1-5), all-time" expandable>
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
        <SectionCard title="Queue snapshot" subtitle="Live — how many messages sit in each state right now" expandable>
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

        <SectionCard title="Recent sending sessions" expandable>
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
