"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard, KpiStrip, StatTile, DataTable } from "../../../../components/chart-kit";
import { Modal } from "../../../../components/ui/modal";
import { UpworkAgencyConnectionGate, UpworkConnectionStatus } from "../../../../components/upwork-agency-connection-gate";

interface WorkHistoryEntry {
  id: string;
  freelancerName: string | null;
  title: string | null;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  totalCharge: string | null;
  totalHours: string | null;
  feedbackToFreelancerScore: number | null;
  feedbackToClientScore: number | null;
}

/** Work History (spec Module T). Part: Upwork API integration —
 *  enterprise UI shell, 2026-10-23; search/filter/detail added as part
 *  of the CRM-functionality pass, 2026-10-23. */
export default function WorkHistoryPage() {
  const statusQuery = useQuery({ queryKey: ["upwork-api-status"], queryFn: () => api.getUpworkApiStatus() as Promise<UpworkConnectionStatus> });
  const connected = Boolean(statusQuery.data?.connected);

  const workHistoryQuery = useQuery({ queryKey: ["upwork-api-work-history"], queryFn: () => api.getUpworkApiWorkHistory(), enabled: connected });
  const workHistory = workHistoryQuery.data;

  const [search, setSearch] = useState("");
  const [contractStatus, setContractStatus] = useState("all");
  const [selected, setSelected] = useState<WorkHistoryEntry | null>(null);

  const all = workHistory?.recent ?? [];
  const statuses = useMemo(() => [...new Set(all.map((e) => e.status).filter((s): s is string => Boolean(s)))], [all]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return all
      .filter((e) => (contractStatus === "all" ? true : e.status === contractStatus))
      .filter((e) => (q ? (e.freelancerName ?? "").toLowerCase().includes(q) || (e.title ?? "").toLowerCase().includes(q) : true));
  }, [all, search, contractStatus]);

  const hasFilters = search !== "" || contractStatus !== "all";

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Work History" />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold tracking-tight">Work History</h1>

      <SectionCard title="Contracts">
        {workHistoryQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
        {workHistory && workHistory.totalCount === 0 && <p className="text-sm text-ink/55">No work history found.</p>}
        {workHistory && workHistory.totalCount > 0 && (
          <div className="flex flex-col gap-4">
            <KpiStrip>
              <StatTile label="Contracts" value={workHistory.totalCount} />
              <StatTile label="Freelancers covered" value={workHistory.freelancerCount} />
            </KpiStrip>

            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search freelancer or contract…"
                className="h-9 w-64 rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm"
              />
              {statuses.length > 0 && (
                <select
                  value={contractStatus}
                  onChange={(e) => setContractStatus(e.target.value)}
                  className="h-9 rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm"
                >
                  <option value="all">All statuses</option>
                  {statuses.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}
              {hasFilters && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setContractStatus("all");
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
              <p className="py-6 text-center text-sm text-ink/50">No contracts match these filters.</p>
            ) : (
              <DataTable
                rowKey={(e) => e.id}
                onRowClick={(e) => setSelected(e)}
                columns={[
                  { key: "freelancer", header: "Freelancer", render: (e) => e.freelancerName ?? "—", sortValue: (e) => e.freelancerName },
                  {
                    key: "title",
                    header: "Contract",
                    render: (e) => <span className="line-clamp-1 max-w-xs">{e.title ?? "—"}</span>,
                    sortValue: (e) => e.title,
                  },
                  { key: "status", header: "Status", render: (e) => e.status ?? "—", sortValue: (e) => e.status },
                  {
                    key: "charge",
                    header: "Charged",
                    render: (e) => e.totalCharge ?? "—",
                    numeric: true,
                    sortValue: (e) => (e.totalCharge ? parseFloat(e.totalCharge.replace(/[^0-9.-]/g, "")) : null),
                  },
                  {
                    key: "feedback",
                    header: "Feedback",
                    render: (e) => (e.feedbackToFreelancerScore != null ? `${e.feedbackToFreelancerScore}★` : "—"),
                    sortValue: (e) => e.feedbackToFreelancerScore,
                  },
                ]}
                rows={filtered}
              />
            )}
          </div>
        )}
      </SectionCard>

      <Modal open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)} variant="drawer-right" title={selected?.title ?? "Contract"} contentClassName="w-full max-w-lg">
        {selected && (
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-ink/50">Freelancer</dt>
              <dd className="font-medium text-ink">{selected.freelancerName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-ink/50">Status</dt>
              <dd className="font-medium text-ink">{selected.status ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-ink/50">Start date</dt>
              <dd className="font-medium text-ink">{selected.startDate ? new Date(selected.startDate).toLocaleDateString() : "—"}</dd>
            </div>
            <div>
              <dt className="text-ink/50">End date</dt>
              <dd className="font-medium text-ink">{selected.endDate ? new Date(selected.endDate).toLocaleDateString() : "—"}</dd>
            </div>
            <div>
              <dt className="text-ink/50">Total charged</dt>
              <dd className="font-medium text-ink">{selected.totalCharge ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-ink/50">Total hours</dt>
              <dd className="font-medium text-ink">{selected.totalHours ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-ink/50">Feedback to freelancer</dt>
              <dd className="font-medium text-ink">{selected.feedbackToFreelancerScore != null ? `${selected.feedbackToFreelancerScore}★` : "—"}</dd>
            </div>
            <div>
              <dt className="text-ink/50">Feedback to client</dt>
              <dd className="font-medium text-ink">{selected.feedbackToClientScore != null ? `${selected.feedbackToClientScore}★` : "—"}</dd>
            </div>
          </dl>
        )}
      </Modal>
    </div>
  );
}
