"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard, DataTable, StatTile, KpiStrip } from "../../../../components/chart-kit";
import { Modal } from "../../../../components/ui/modal";
import { UpworkAgencyConnectionGate, UpworkConnectionStatus } from "../../../../components/upwork-agency-connection-gate";
import { useDateFilter } from "../../../../lib/use-date-filter";
import { DateRangeFilter } from "../../../../components/ui/date-range-filter";

interface ContractProposal {
  id: string;
  referenceContractRid: string | null;
  createdDate: string | null;
  jobTitle: string | null;
  clientName: string | null;
}

const PAGE_SIZE = 25;

/** Contract Proposals (spec Module L), read-only. Part: Upwork API
 *  integration — enterprise UI shell, 2026-10-23; search, client-side
 *  filtering, and real pagination (the backend already supported a
 *  `page` param — this just exposes it) added as part of the
 *  CRM-functionality pass, 2026-10-23. */
export default function ContractProposalsPage() {
  const statusQuery = useQuery({ queryKey: ["upwork-api-status"], queryFn: () => api.getUpworkApiStatus() as Promise<UpworkConnectionStatus> });
  const connected = Boolean(statusQuery.data?.connected);

  const [page, setPage] = useState(1);
  const contractProposalsQuery = useQuery({
    queryKey: ["upwork-api-contract-proposals", page],
    queryFn: () => api.getUpworkApiContractProposals(page),
    enabled: connected,
  });
  const data = contractProposalsQuery.data;

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ContractProposal | null>(null);

  // Server-paginated — this only filters the current page, not the full
  // server-side result set (same known limitation as the column sort
  // below).
  const { filteredRows: dateFiltered, from: dateFrom, to: dateTo, setFrom: setDateFrom, setTo: setDateTo, clear: clearDate } =
    useDateFilter(data?.contracts ?? [], (c) => c.createdDate);

  const filtered = useMemo(() => {
    if (!search) return dateFiltered;
    const q = search.toLowerCase();
    return dateFiltered.filter((c) => (c.jobTitle ?? "").toLowerCase().includes(q) || (c.clientName ?? "").toLowerCase().includes(q));
  }, [dateFiltered, search]);

  const totalPages = data ? Math.max(1, Math.ceil(data.totalCount / PAGE_SIZE)) : 1;

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Contract Proposals" />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold tracking-tight">Contract Proposals</h1>

      <SectionCard title="Contract proposals">
        {contractProposalsQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
        {contractProposalsQuery.error && <p className="text-sm text-bad">{(contractProposalsQuery.error as Error).message}</p>}
        {data && (
          <div className="flex flex-col gap-4">
            <KpiStrip>
              <StatTile label="Total" value={data.totalCount} />
            </KpiStrip>

            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search job or client…"
                className="h-9 w-64 rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm"
              />
              <DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} onClear={clearDate} />
            </div>

            {data.contracts.length === 0 ? (
              <p className="text-sm text-ink/55">No contract proposals currently.</p>
            ) : filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink/50">No contract proposals match this search.</p>
            ) : (
              // Server-paginated — column sort below only orders the current page.
              <DataTable
                rowKey={(c) => c.id}
                onRowClick={(c) => setSelected(c)}
                showSummary
                columns={[
                  { key: "job", header: "Job", render: (c) => c.jobTitle ?? "—", sortValue: (c) => c.jobTitle },
                  { key: "client", header: "Client", render: (c) => c.clientName ?? "—", sortValue: (c) => c.clientName },
                  {
                    key: "date",
                    header: "Created",
                    render: (c) => (c.createdDate ? new Date(c.createdDate).toLocaleDateString() : "—"),
                    sortValue: (c) => (c.createdDate ? new Date(c.createdDate).getTime() : null),
                  },
                ]}
                rows={filtered}
              />
            )}

            {totalPages > 1 && (
              <div className="flex items-center justify-between text-xs text-ink/55">
                <span>
                  Page {data.page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="rounded-md border border-[var(--line)] px-3 py-1 disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="rounded-md border border-[var(--line)] px-3 py-1 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      <Modal open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)} variant="drawer-right" title={selected?.jobTitle ?? "Contract proposal"} contentClassName="w-full max-w-lg">
        {selected && (
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-ink/50">Client</dt>
              <dd className="font-medium text-ink">{selected.clientName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-ink/50">Created</dt>
              <dd className="font-medium text-ink">{selected.createdDate ? new Date(selected.createdDate).toLocaleDateString() : "—"}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-ink/50">Reference contract ID</dt>
              <dd className="font-medium text-ink">{selected.referenceContractRid ?? "—"}</dd>
            </div>
          </dl>
        )}
      </Modal>
    </div>
  );
}
