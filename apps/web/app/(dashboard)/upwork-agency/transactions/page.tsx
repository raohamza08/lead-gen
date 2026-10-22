"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard, KpiStrip, StatTile, DataTable } from "../../../../components/chart-kit";
import { UpworkAgencyConnectionGate, UpworkConnectionStatus } from "../../../../components/upwork-agency-connection-gate";

/** Transactions & Financial History (spec Module B) + Connects usage.
 *  Part: Upwork API integration — enterprise UI shell, 2026-10-23. */
export default function TransactionsPage() {
  const statusQuery = useQuery({ queryKey: ["upwork-api-status"], queryFn: () => api.getUpworkApiStatus() as Promise<UpworkConnectionStatus> });
  const connected = Boolean(statusQuery.data?.connected);

  const connectsQuery = useQuery({ queryKey: ["upwork-api-connects-usage"], queryFn: () => api.getUpworkApiConnectsUsage(), enabled: connected });
  const connects = connectsQuery.data;

  const transactionsQuery = useQuery({ queryKey: ["upwork-api-transactions"], queryFn: () => api.getUpworkApiTransactions(), enabled: connected });
  const transactions = transactionsQuery.data;

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Transactions & Financial History" />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold tracking-tight">Transactions & Financial History</h1>

      <SectionCard title="Connects usage" subtitle="Live balance and spend history, synced every 6 hours.">
        {connectsQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
        {connects?.current && (
          <KpiStrip>
            <StatTile label="Connects Balance" value={connects.current.connectsBalance} />
            <StatTile label="Free" value={connects.current.connectsBalanceFree} />
            <StatTile label="Paid" value={connects.current.connectsBalancePaid} />
            <StatTile label="Rollover" value={connects.current.rolloverBalance} />
          </KpiStrip>
        )}
      </SectionCard>

      <SectionCard title="Transactions" subtitle="Real financial ledger synced every 6 hours — fees, invoices, withdrawals, refunds.">
        {transactionsQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
        {transactions && transactions.totalCount > 0 && (
          <div className="flex flex-col gap-4">
            <KpiStrip>
              <StatTile label="Total transactions" value={transactions.totalCount} />
              {transactions.countBySubtype.slice(0, 3).map((s) => (
                <StatTile key={`${s.subtype}-${s.currency}`} label={s.subtype ?? "Other"} value={s.count} />
              ))}
            </KpiStrip>
            <DataTable
              rowKey={(t) => t.id}
              columns={[
                { key: "date", header: "Date", render: (t) => (t.occurredAt ? new Date(t.occurredAt).toLocaleDateString() : "—") },
                { key: "subtype", header: "Type", render: (t) => t.accountingSubtype ?? t.type ?? "—" },
                { key: "description", header: "Description", render: (t) => <span className="line-clamp-1 max-w-xs">{t.description ?? "—"}</span> },
                { key: "amount", header: "Amount", render: (t) => (t.amountDisplay ? `${t.amountDisplay} ${t.amountCurrency ?? ""}` : "—"), numeric: true },
              ]}
              rows={transactions.recent}
            />
          </div>
        )}
      </SectionCard>
    </div>
  );
}
