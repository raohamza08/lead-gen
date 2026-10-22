"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard, KpiStrip, StatTile, DataTable } from "../../../../components/chart-kit";
import { UpworkAgencyConnectionGate, UpworkConnectionStatus } from "../../../../components/upwork-agency-connection-gate";

/** Invites (spec Module I). Part: Upwork API integration — enterprise
 *  UI shell, 2026-10-23. Deliberately separate from Bidding & Proposals. */
export default function InvitesPage() {
  const statusQuery = useQuery({ queryKey: ["upwork-api-status"], queryFn: () => api.getUpworkApiStatus() as Promise<UpworkConnectionStatus> });
  const status = statusQuery.data;
  const connected = Boolean(status?.connected);

  const invitesQuery = useQuery({ queryKey: ["upwork-api-invites"], queryFn: () => api.getUpworkApiInvites(), enabled: connected });
  const invites = invitesQuery.data;

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Invites" />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold tracking-tight">Invites</h1>
      <p className="text-xs text-ink/50">
        Client invitations your freelancers received{status?.organizationName ? ` under ${status.organizationName}` : ""}, synced every 6 hours — tracked separately from Bidding & Proposals.
      </p>

      <SectionCard title="Invites">
        {invitesQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
        {invites && invites.totalCount > 0 && (
          <div className="flex flex-col gap-4">
            <KpiStrip>
              {Object.entries(invites.countByStatus)
                .filter(([, count]) => count > 0)
                .map(([status_, count]) => (
                  <StatTile key={status_} label={status_} value={count} />
                ))}
            </KpiStrip>
            <DataTable
              rowKey={(i) => i.id}
              columns={[
                { key: "job", header: "Job", render: (i) => i.jobTitle ?? "—" },
                { key: "client", header: "Client", render: (i) => i.clientName ?? "—" },
                { key: "freelancer", header: "Sent to", render: (i) => i.freelancerName ?? "—" },
                { key: "status", header: "Status", render: (i) => i.status ?? "—" },
                { key: "updated", header: "Updated", render: (i) => (i.upworkModifiedAt ? new Date(i.upworkModifiedAt).toLocaleString() : "—") },
              ]}
              rows={invites.recent}
            />
          </div>
        )}
      </SectionCard>
    </div>
  );
}
