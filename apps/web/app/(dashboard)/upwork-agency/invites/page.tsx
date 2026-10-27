"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard, KpiStrip, StatTile, DataTable } from "../../../../components/chart-kit";
import { Modal } from "../../../../components/ui/modal";
import { UpworkAgencyConnectionGate, UpworkConnectionStatus } from "../../../../components/upwork-agency-connection-gate";

interface Invite {
  id: string;
  context: "Freelancer" | "Agency" | null;
  jobTitle: string | null;
  clientName: string | null;
  freelancerName: string | null;
  status: string | null;
  invitationLetter: string | null;
  acceptanceDuration: string | null;
  upfrontPaymentPct: number | null;
  upworkCreatedAt: string | null;
  upworkModifiedAt: string | null;
}

/** Invites (spec Module I). Part: Upwork API integration — enterprise
 *  UI shell, 2026-10-23. Deliberately separate from Bidding & Proposals.
 *  Rows are clickable (Part: click-through detail views, 2026-10-23,
 *  explicit user request) — every field already fetched from Upwork is
 *  shown in the detail drawer, not just the table's 5 summary columns. */
export default function InvitesPage() {
  const statusQuery = useQuery({ queryKey: ["upwork-api-status"], queryFn: () => api.getUpworkApiStatus() as Promise<UpworkConnectionStatus> });
  const status = statusQuery.data;
  const connected = Boolean(status?.connected);

  const invitesQuery = useQuery({ queryKey: ["upwork-api-invites"], queryFn: () => api.getUpworkApiInvites(), enabled: connected });
  const invites = invitesQuery.data;

  const [selected, setSelected] = useState<Invite | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const all = invites?.recent ?? [];
  const unanswered = useMemo(() => all.filter((i) => i.status === "Pending"), [all]);
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return all
      .filter((i) => (statusFilter ? i.status === statusFilter : true))
      .filter((i) =>
        q
          ? (i.jobTitle ?? "").toLowerCase().includes(q) ||
            (i.clientName ?? "").toLowerCase().includes(q) ||
            (i.freelancerName ?? "").toLowerCase().includes(q)
          : true,
      );
  }, [all, search, statusFilter]);
  const hasFilters = search !== "" || statusFilter !== null;

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Invites" />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold tracking-tight">Invites</h1>

      {unanswered.length > 0 && (
        <SectionCard title={`Unanswered invites (${unanswered.length})`} subtitle="New agency invites that haven't been accepted, declined, or withdrawn yet.">
          <DataTable
            rowKey={(i) => i.id}
            onRowClick={(i) => setSelected(i)}
            columns={[
              { key: "job", header: "Job", render: (i) => i.jobTitle ?? "—", sortValue: (i) => i.jobTitle },
              { key: "client", header: "Client", render: (i) => i.clientName ?? "—", sortValue: (i) => i.clientName },
              { key: "freelancer", header: "Sent to", render: (i) => i.freelancerName ?? "—", sortValue: (i) => i.freelancerName },
              {
                key: "received",
                header: "Received",
                render: (i) => (i.upworkCreatedAt ? new Date(i.upworkCreatedAt).toLocaleString() : "—"),
                sortValue: (i) => (i.upworkCreatedAt ? new Date(i.upworkCreatedAt).getTime() : null),
              },
            ]}
            rows={unanswered}
          />
        </SectionCard>
      )}

      <SectionCard title="Invites">
        {invitesQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
        {invites && invites.totalCount > 0 && (
          <div className="flex flex-col gap-4">
            <KpiStrip>
              {Object.entries(invites.countByStatus)
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
                placeholder="Search job, client, or freelancer…"
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
              <p className="py-6 text-center text-sm text-ink/50">No invites match these filters.</p>
            ) : (
              <DataTable
                rowKey={(i) => i.id}
                onRowClick={(i) => setSelected(i)}
                columns={[
                  { key: "job", header: "Job", render: (i) => i.jobTitle ?? "—", sortValue: (i) => i.jobTitle },
                  { key: "client", header: "Client", render: (i) => i.clientName ?? "—", sortValue: (i) => i.clientName },
                  { key: "freelancer", header: "Sent to", render: (i) => i.freelancerName ?? "—", sortValue: (i) => i.freelancerName },
                  { key: "status", header: "Status", render: (i) => i.status ?? "—", sortValue: (i) => i.status },
                  {
                    key: "updated",
                    header: "Updated",
                    render: (i) => (i.upworkModifiedAt ? new Date(i.upworkModifiedAt).toLocaleString() : "—"),
                    sortValue: (i) => (i.upworkModifiedAt ? new Date(i.upworkModifiedAt).getTime() : null),
                  },
                ]}
                rows={filtered}
              />
            )}
          </div>
        )}
      </SectionCard>

      <Modal open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)} variant="drawer-right" title={selected?.jobTitle ?? "Invite"} contentClassName="w-full max-w-lg">
        {selected && (
          <div className="flex flex-col gap-4 text-sm">
            <dl className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <dt className="text-ink/50">Status</dt>
                <dd className="font-medium text-ink">{selected.status ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-ink/50">Context</dt>
                <dd className="font-medium text-ink">{selected.context ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-ink/50">Client</dt>
                <dd className="font-medium text-ink">{selected.clientName ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-ink/50">Sent to</dt>
                <dd className="font-medium text-ink">{selected.freelancerName ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-ink/50">Acceptance duration</dt>
                <dd className="font-medium text-ink">{selected.acceptanceDuration ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-ink/50">Upfront payment</dt>
                <dd className="font-medium text-ink">{selected.upfrontPaymentPct != null ? `${selected.upfrontPaymentPct}%` : "—"}</dd>
              </div>
              <div>
                <dt className="text-ink/50">Created</dt>
                <dd className="font-medium text-ink">{selected.upworkCreatedAt ? new Date(selected.upworkCreatedAt).toLocaleString() : "—"}</dd>
              </div>
              <div>
                <dt className="text-ink/50">Last updated</dt>
                <dd className="font-medium text-ink">{selected.upworkModifiedAt ? new Date(selected.upworkModifiedAt).toLocaleString() : "—"}</dd>
              </div>
            </dl>

            <div>
              <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink/55">Invitation letter</h4>
              <p className="whitespace-pre-wrap text-sm text-ink/80">{selected.invitationLetter ?? "—"}</p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
