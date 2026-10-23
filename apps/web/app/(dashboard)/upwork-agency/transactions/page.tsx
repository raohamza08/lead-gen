"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard, KpiStrip, StatTile, DataTable } from "../../../../components/chart-kit";
import { Modal } from "../../../../components/ui/modal";
import { UpworkAgencyConnectionGate, UpworkConnectionStatus } from "../../../../components/upwork-agency-connection-gate";

interface Transaction {
  id: string;
  occurredAt: string | null;
  type: string | null;
  accountingSubtype: string | null;
  description: string | null;
  amountDisplay: string | null;
  amountCurrency: string | null;
  paymentStatus: string | null;
}

/** Transactions & Financial History (spec Module B) + Connects usage.
 *  Part: Upwork API integration — enterprise UI shell, 2026-10-23;
 *  search/filter/sort/detail added as part of the CRM-functionality pass,
 *  2026-10-23 (scope confirmed: Upwork Agency module only). */
export default function TransactionsPage() {
  const statusQuery = useQuery({ queryKey: ["upwork-api-status"], queryFn: () => api.getUpworkApiStatus() as Promise<UpworkConnectionStatus> });
  const connected = Boolean(statusQuery.data?.connected);

  const connectsQuery = useQuery({ queryKey: ["upwork-api-connects-usage"], queryFn: () => api.getUpworkApiConnectsUsage(), enabled: connected });
  const connects = connectsQuery.data;

  const transactionsQuery = useQuery({ queryKey: ["upwork-api-transactions"], queryFn: () => api.getUpworkApiTransactions(), enabled: connected });
  const transactions = transactionsQuery.data;

  const [search, setSearch] = useState("");
  const [subtypeFilter, setSubtypeFilter] = useState("all");
  const [oldestFirst, setOldestFirst] = useState(false);
  const [selected, setSelected] = useState<Transaction | null>(null);

  const all = transactions?.recent ?? [];
  const subtypes = useMemo(
    () => [...new Set(all.map((t) => t.accountingSubtype ?? t.type).filter((v): v is string => Boolean(v)))],
    [all],
  );

  const filtered = useMemo(() => {
    return all
      .filter((t) => (subtypeFilter === "all" ? true : (t.accountingSubtype ?? t.type) === subtypeFilter))
      .filter((t) => (search ? (t.description ?? "").toLowerCase().includes(search.toLowerCase()) : true))
      .sort((a, b) => {
        const diff = new Date(a.occurredAt ?? 0).getTime() - new Date(b.occurredAt ?? 0).getTime();
        return oldestFirst ? diff : -diff;
      });
  }, [all, subtypeFilter, search, oldestFirst]);

  const hasFilters = search !== "" || subtypeFilter !== "all";

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Transactions & Financial History" />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold tracking-tight">Transactions & Financial History</h1>

      <SectionCard title="Connects usage">
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

      <SectionCard title="Transactions">
        {transactionsQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
        {transactionsQuery.error && <p className="text-sm text-bad">{(transactionsQuery.error as Error).message}</p>}
        {transactions && transactions.totalCount === 0 && <p className="text-sm text-ink/55">No transactions found.</p>}
        {transactions && transactions.totalCount > 0 && (
          <div className="flex flex-col gap-4">
            <KpiStrip>
              <StatTile label="Total transactions" value={transactions.totalCount} />
              {transactions.countBySubtype.slice(0, 3).map((s) => (
                <StatTile key={`${s.subtype}-${s.currency}`} label={s.subtype ?? "Other"} value={s.count} />
              ))}
            </KpiStrip>

            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search description…"
                className="h-9 w-56 rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm"
              />
              {subtypes.length > 0 && (
                <select
                  value={subtypeFilter}
                  onChange={(e) => setSubtypeFilter(e.target.value)}
                  className="h-9 rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm"
                >
                  <option value="all">All types</option>
                  {subtypes.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={() => setOldestFirst((v) => !v)}
                className="h-9 rounded-md border border-[var(--line)] px-3 text-xs text-ink/70 hover:bg-ink/5"
              >
                {oldestFirst ? "Oldest first" : "Newest first"}
              </button>
              {hasFilters && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setSubtypeFilter("all");
                  }}
                  className="h-9 rounded-md px-3 text-xs text-accent hover:underline"
                >
                  Clear filters
                </button>
              )}
              <span className="text-xs text-ink/40">
                {filtered.length} of {all.length} shown
              </span>
            </div>

            {filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink/50">No transactions match these filters.</p>
            ) : (
              <DataTable
                rowKey={(t) => t.id}
                onRowClick={(t) => setSelected(t)}
                columns={[
                  { key: "date", header: "Date", render: (t) => (t.occurredAt ? new Date(t.occurredAt).toLocaleDateString() : "—") },
                  { key: "subtype", header: "Type", render: (t) => t.accountingSubtype ?? t.type ?? "—" },
                  { key: "description", header: "Description", render: (t) => <span className="line-clamp-1 max-w-xs">{t.description ?? "—"}</span> },
                  { key: "amount", header: "Amount", render: (t) => (t.amountDisplay ? `${t.amountDisplay} ${t.amountCurrency ?? ""}` : "—"), numeric: true },
                ]}
                rows={filtered}
              />
            )}
          </div>
        )}
      </SectionCard>

      <Modal open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)} variant="drawer-right" title="Transaction" contentClassName="w-full max-w-lg">
        {selected && (
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-ink/50">Date</dt>
              <dd className="font-medium text-ink">{selected.occurredAt ? new Date(selected.occurredAt).toLocaleString() : "—"}</dd>
            </div>
            <div>
              <dt className="text-ink/50">Type</dt>
              <dd className="font-medium text-ink">{selected.type ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-ink/50">Subtype</dt>
              <dd className="font-medium text-ink">{selected.accountingSubtype ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-ink/50">Payment status</dt>
              <dd className="font-medium text-ink">{selected.paymentStatus ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-ink/50">Amount</dt>
              <dd className="font-medium text-ink">{selected.amountDisplay ? `${selected.amountDisplay} ${selected.amountCurrency ?? ""}` : "—"}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-ink/50">Description</dt>
              <dd className="font-medium text-ink">{selected.description ?? "—"}</dd>
            </div>
          </dl>
        )}
      </Modal>
    </div>
  );
}
