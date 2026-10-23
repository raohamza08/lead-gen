"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard, KpiStrip, StatTile, DataTable } from "../../../../components/chart-kit";
import { Modal } from "../../../../components/ui/modal";
import { UpworkAgencyConnectionGate, UpworkConnectionStatus } from "../../../../components/upwork-agency-connection-gate";

interface Proposal {
  id: string;
  jobTitle: string | null;
  freelancerName: string | null;
  status: string;
  statusReason: string | null;
  chargeRateDisplay: string | null;
  viewedByClient: boolean | null;
  upworkCreatedAt: string | null;
  upworkModifiedAt: string | null;
}

/** Bidding & Proposals (spec Module J's data + Offers disclosure).
 *  Part: Upwork API integration — enterprise UI shell, 2026-10-23. Rows
 *  are clickable (Part: click-through detail views, 2026-10-23, explicit
 *  user request) — every field already fetched from Upwork is shown in
 *  the detail drawer, not just the table's 5 summary columns. */
export default function BiddingPage() {
  const statusQuery = useQuery({ queryKey: ["upwork-api-status"], queryFn: () => api.getUpworkApiStatus() as Promise<UpworkConnectionStatus> });
  const status = statusQuery.data;
  const connected = Boolean(status?.connected);

  const proposalsQuery = useQuery({ queryKey: ["upwork-api-proposals"], queryFn: () => api.getUpworkApiProposals(), enabled: connected });
  const proposals = proposalsQuery.data;

  const [selected, setSelected] = useState<Proposal | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const all = proposals?.recent ?? [];
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return all
      .filter((p) => (statusFilter ? p.status === statusFilter : true))
      .filter((p) => (q ? (p.jobTitle ?? "").toLowerCase().includes(q) || (p.freelancerName ?? "").toLowerCase().includes(q) : true));
  }, [all, search, statusFilter]);
  const hasFilters = search !== "" || statusFilter !== null;

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Bidding & Proposals" />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold tracking-tight">Bidding & Proposals</h1>

      <SectionCard title="Proposals">
        {proposalsQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
        {proposals && proposals.totalCount > 0 && (
          <div className="flex flex-col gap-4">
            <KpiStrip>
              {Object.entries(proposals.countByStatus)
                .filter(([, count]) => count > 0)
                .map(([status_, count]) => (
                  <StatTile
                    key={status_}
                    label={status_}
                    value={count}
                    active={statusFilter === status_}
                    onClick={() => setStatusFilter((current) => (current === status_ ? null : status_))}
                  />
                ))}
            </KpiStrip>

            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search job or freelancer…"
                className="h-9 w-64 rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm"
              />
              {hasFilters && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setStatusFilter(null);
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
              <p className="py-6 text-center text-sm text-ink/50">No proposals match these filters.</p>
            ) : (
              <DataTable
                rowKey={(p) => p.id}
                onRowClick={(p) => setSelected(p)}
                columns={[
                  { key: "job", header: "Job", render: (p) => p.jobTitle ?? "—" },
                  { key: "freelancer", header: "Freelancer", render: (p) => p.freelancerName ?? "—" },
                  { key: "status", header: "Status", render: (p) => p.status },
                  { key: "rate", header: "Rate", render: (p) => p.chargeRateDisplay ?? "—", numeric: true },
                  { key: "updated", header: "Updated", render: (p) => (p.upworkModifiedAt ? new Date(p.upworkModifiedAt).toLocaleString() : "—") },
                ]}
                rows={filtered}
              />
            )}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Offers" subtitle="Not currently available.">
        <p className="text-xs text-ink/50">
          Blocked by a reproducible Upwork backend error (offersByAttributes times out) — confirmed real schema, not a missing permission. Re-checked automatically; will start working if Upwork&apos;s issue clears.
        </p>
      </SectionCard>

      <Modal open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)} variant="drawer-right" title={selected?.jobTitle ?? "Proposal"} contentClassName="w-full max-w-lg">
        {selected && (
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-ink/50">Status</dt>
              <dd className="font-medium text-ink">{selected.status}</dd>
            </div>
            <div>
              <dt className="text-ink/50">Status reason</dt>
              <dd className="font-medium text-ink">{selected.statusReason ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-ink/50">Freelancer</dt>
              <dd className="font-medium text-ink">{selected.freelancerName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-ink/50">Rate</dt>
              <dd className="font-medium text-ink">{selected.chargeRateDisplay ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-ink/50">Viewed by client</dt>
              <dd className="font-medium text-ink">{selected.viewedByClient == null ? "—" : selected.viewedByClient ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt className="text-ink/50">Created</dt>
              <dd className="font-medium text-ink">{selected.upworkCreatedAt ? new Date(selected.upworkCreatedAt).toLocaleString() : "—"}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-ink/50">Last updated</dt>
              <dd className="font-medium text-ink">{selected.upworkModifiedAt ? new Date(selected.upworkModifiedAt).toLocaleString() : "—"}</dd>
            </div>
          </dl>
        )}
      </Modal>
    </div>
  );
}
