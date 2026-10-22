"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard, KpiStrip, StatTile, DataTable } from "../../../../components/chart-kit";
import { UpworkAgencyConnectionGate, UpworkConnectionStatus } from "../../../../components/upwork-agency-connection-gate";

/** Bidding & Proposals (spec Module J's data + Offers disclosure).
 *  Part: Upwork API integration — enterprise UI shell, 2026-10-23. */
export default function BiddingPage() {
  const statusQuery = useQuery({ queryKey: ["upwork-api-status"], queryFn: () => api.getUpworkApiStatus() as Promise<UpworkConnectionStatus> });
  const status = statusQuery.data;
  const connected = Boolean(status?.connected);

  const proposalsQuery = useQuery({ queryKey: ["upwork-api-proposals"], queryFn: () => api.getUpworkApiProposals(), enabled: connected });
  const proposals = proposalsQuery.data;

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Bidding & Proposals" />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold tracking-tight">Bidding & Proposals</h1>
      <p className="text-xs text-ink/50">
        Your real submitted proposals/bids{status?.organizationName ? ` for ${status.organizationName}` : ""}, synced every 6 hours.
      </p>

      <SectionCard title="Proposals">
        {proposalsQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
        {proposals && proposals.totalCount > 0 && (
          <div className="flex flex-col gap-4">
            <KpiStrip>
              {Object.entries(proposals.countByStatus)
                .filter(([, count]) => count > 0)
                .map(([status_, count]) => (
                  <StatTile key={status_} label={status_} value={count} />
                ))}
            </KpiStrip>
            <DataTable
              rowKey={(p) => p.id}
              columns={[
                { key: "job", header: "Job", render: (p) => p.jobTitle ?? "—" },
                { key: "freelancer", header: "Freelancer", render: (p) => p.freelancerName ?? "—" },
                { key: "status", header: "Status", render: (p) => p.status },
                { key: "rate", header: "Rate", render: (p) => p.chargeRateDisplay ?? "—", numeric: true },
                { key: "updated", header: "Updated", render: (p) => (p.upworkModifiedAt ? new Date(p.upworkModifiedAt).toLocaleString() : "—") },
              ]}
              rows={proposals.recent}
            />
          </div>
        )}
      </SectionCard>

      <SectionCard title="Offers" subtitle="Not currently available.">
        <p className="text-xs text-ink/50">
          Blocked by a reproducible Upwork backend error (offersByAttributes times out) — confirmed real schema, not a missing permission. Re-checked automatically; will start working if Upwork's issue clears.
        </p>
      </SectionCard>
    </div>
  );
}
