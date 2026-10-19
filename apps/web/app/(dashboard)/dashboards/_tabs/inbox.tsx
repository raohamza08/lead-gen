"use client";

import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../../../lib/api-client";
import { DashboardCenterShell, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";
import { dashboardRangeToQuery } from "../../../../components/dashboard-center/date-range-bar";
import { num, dateTime, titleCase } from "../../../../components/dashboard-center/format";
import { MetricDetail } from "../../../../components/dashboard-center/metric-detail";
import { AXIS_PROPS, ChartWithTable, DataTable, GRID_PROPS, KpiStrip, Legend, SectionCard, SERIES, StatTile, TOOLTIP_STYLE, formatCompact } from "../../../../components/chart-kit";
import { ErrorState } from "../../../../components/ui/error-state";
import { SkeletonCard } from "../../../../components/ui/skeleton";
import { EmptyState } from "../../../../components/ui/empty-state";
import { StatusBadge } from "../../../../components/ui/status-badge";

interface AccountRow {
  id: string;
  address: string;
  label: string | null;
  provider: string;
  status: string;
  received: number;
  sent: number;
  unread: number;
  threads: number;
}

interface VolumeSnapshot {
  received: number;
  sent: number;
  unread: number;
}

interface LeadFromEmailRow {
  threadId: string;
  subject: string | null;
  leadId: string | null;
  account: string;
  date: string;
}

function statusTone(status: string): "success" | "warning" | "error" | "neutral" {
  if (status === "SUSPENDED" || status === "SYNC_DISABLED") return "error";
  if (status === "ACTIVE" || status === "CONNECTED") return "success";
  return "neutral";
}

export function InboxTab() {
  const [dateRange, setDateRange] = useDashboardDateRange();
  const query = dashboardRangeToQuery(dateRange);

  const accountsQuery = useQuery({
    queryKey: ["dc-inbox-accounts", query],
    queryFn: () => api.getDashboardInboxAccounts(query) as Promise<AccountRow[]>,
  });
  const volumeQuery = useQuery({
    queryKey: ["dc-inbox-volume", query],
    queryFn: () => api.getDashboardInboxVolume(query) as Promise<VolumeSnapshot>,
  });
  const leadsQuery = useQuery({
    queryKey: ["dc-inbox-leads", query],
    queryFn: () => api.getDashboardInboxLeadsFromEmail(query) as Promise<LeadFromEmailRow[]>,
  });

  const accounts = accountsQuery.data ?? [];
  const volume = volumeQuery.data;
  const leads = leadsQuery.data ?? [];

  return (
    <DashboardCenterShell
      compact
      title="Unified Inbox Dashboard"
      subtitle="Per-mailbox volume and health, plus leads created from inbound email replies/threads."
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      onRefresh={() => {
        accountsQuery.refetch();
        volumeQuery.refetch();
        leadsQuery.refetch();
      }}
      refreshing={accountsQuery.isFetching || volumeQuery.isFetching || leadsQuery.isFetching}
    >
      {volumeQuery.isLoading && <SkeletonCard className="h-24" />}
      {volumeQuery.error && <ErrorState message={(volumeQuery.error as Error).message} onRetry={() => volumeQuery.refetch()} />}
      {volume && (
        <KpiStrip>
          <StatTile
            label="Received"
            value={num(volume.received)}
            detail={
              <MetricDetail
                definition="Inbound messages received across every connected mailbox in the selected period."
                rows={[
                  { label: "Received", value: num(volume.received) },
                  { label: "Mailboxes", value: num(accounts.length) },
                ]}
              />
            }
          />
          <StatTile
            label="Sent"
            value={num(volume.sent)}
            detail={<MetricDetail definition="Outbound campaign messages sent in the selected period, across the whole org." rows={[{ label: "Sent", value: num(volume.sent) }]} />}
          />
          <StatTile
            label="Unread"
            value={num(volume.unread)}
            detail={
              <MetricDetail
                definition="Inbound messages not yet marked read, across every connected mailbox — a live snapshot, not scoped to the date range."
                rows={[{ label: "Unread", value: num(volume.unread) }]}
              />
            }
          />
        </KpiStrip>
      )}

      {accountsQuery.isLoading && <SkeletonCard className="h-32" />}
      {accountsQuery.error && <ErrorState message={(accountsQuery.error as Error).message} onRetry={() => accountsQuery.refetch()} />}
      {!accountsQuery.isLoading && accounts.length === 0 && (
        <SectionCard title="Mailboxes" subtitle="Per-account received/sent/unread and sync health">
          <EmptyState title="No email accounts connected" />
        </SectionCard>
      )}
      {accounts.length > 0 && (
        // Real-chart pass (Part: Dashboard Center, 2026-10-19) — same
        // `accounts` rows the table already had, just given a per-mailbox
        // comparison view alongside it.
        <ChartWithTable
          title="Mailboxes"
          subtitle="Per-account received/sent/unread and sync health"
          expandable
          chart={
            <>
              <Legend items={[{ label: "Received", color: SERIES[0] }, { label: "Sent", color: SERIES[1] }, { label: "Unread", color: SERIES[2] }]} />
              <ResponsiveContainer width="100%" height={Math.max(220, accounts.length * 56)}>
                <BarChart data={accounts} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis type="number" {...AXIS_PROPS} tickFormatter={formatCompact} allowDecimals={false} />
                  <YAxis type="category" dataKey={(r: AccountRow) => r.label ?? r.address} {...AXIS_PROPS} width={140} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Bar dataKey="received" name="Received" fill={SERIES[0]} radius={[0, 3, 3, 0]} />
                  <Bar dataKey="sent" name="Sent" fill={SERIES[1]} radius={[0, 3, 3, 0]} />
                  <Bar dataKey="unread" name="Unread" fill={SERIES[2]} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </>
          }
          table={
            <DataTable
              rowKey={(r) => r.id}
              rows={accounts}
              columns={[
                { key: "address", header: "Mailbox", render: (r) => r.label ?? r.address },
                { key: "provider", header: "Provider", render: (r) => titleCase(r.provider) },
                { key: "status", header: "Status", render: (r) => <StatusBadge tone={statusTone(r.status)} label={titleCase(r.status)} /> },
                { key: "received", header: "Received", render: (r) => num(r.received), numeric: true },
                { key: "sent", header: "Sent", render: (r) => num(r.sent), numeric: true },
                { key: "unread", header: "Unread", render: (r) => num(r.unread), numeric: true },
                { key: "threads", header: "Threads", render: (r) => num(r.threads), numeric: true },
              ]}
            />
          }
        />
      )}

      <SectionCard
        title="Leads created from inbound email"
        subtitle="No separate 'website form submission' model exists in the schema — this covers any inbound thread linked to a real Lead, not just contact-form fills"
        expandable
      >
        {leadsQuery.isLoading && <SkeletonCard className="h-32" />}
        {leadsQuery.error && <ErrorState message={(leadsQuery.error as Error).message} onRetry={() => leadsQuery.refetch()} />}
        {!leadsQuery.isLoading && leads.length === 0 && <EmptyState title="No leads created from inbound email in this period" />}
        {leads.length > 0 && (
          <DataTable
            rowKey={(r) => r.threadId}
            rows={leads}
            columns={[
              { key: "date", header: "Date", render: (r) => dateTime(r.date) },
              { key: "subject", header: "Subject", render: (r) => r.subject ?? "—" },
              { key: "account", header: "Mailbox", render: (r) => r.account },
              {
                key: "lead",
                header: "Lead",
                render: (r) =>
                  r.leadId ? (
                    <a href={`/leads/${r.leadId}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      View lead
                    </a>
                  ) : (
                    "—"
                  ),
              },
            ]}
          />
        )}
      </SectionCard>
    </DashboardCenterShell>
  );
}
