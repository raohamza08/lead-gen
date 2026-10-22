"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard, DataTable, StatTile, KpiStrip } from "../../../../components/chart-kit";
import { UpworkAgencyConnectionGate, UpworkConnectionStatus } from "../../../../components/upwork-agency-connection-gate";

/** Contract Proposals (spec Module L), read-only. Part: Upwork API
 *  integration — enterprise UI shell, 2026-10-23. */
export default function ContractProposalsPage() {
  const statusQuery = useQuery({ queryKey: ["upwork-api-status"], queryFn: () => api.getUpworkApiStatus() as Promise<UpworkConnectionStatus> });
  const connected = Boolean(statusQuery.data?.connected);

  const contractProposalsQuery = useQuery({
    queryKey: ["upwork-api-contract-proposals"],
    queryFn: () => api.getUpworkApiContractProposals(),
    enabled: connected,
  });
  const data = contractProposalsQuery.data;

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Contract Proposals" />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold tracking-tight">Contract Proposals</h1>
      <p className="text-xs text-ink/50">Read-only, live from Upwork — contract-formation-stage proposals for this agency team.</p>

      <SectionCard title="Contract proposals">
        {contractProposalsQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
        {contractProposalsQuery.error && <p className="text-sm text-bad">{(contractProposalsQuery.error as Error).message}</p>}
        {data && (
          <div className="flex flex-col gap-4">
            <KpiStrip>
              <StatTile label="Total" value={data.totalCount} />
            </KpiStrip>
            {data.contracts.length === 0 ? (
              <p className="text-sm text-ink/55">No contract proposals currently.</p>
            ) : (
              <DataTable
                rowKey={(c) => c.id}
                columns={[
                  { key: "job", header: "Job", render: (c) => c.jobTitle ?? "—" },
                  { key: "client", header: "Client", render: (c) => c.clientName ?? "—" },
                  { key: "date", header: "Created", render: (c) => (c.createdDate ? new Date(c.createdDate).toLocaleDateString() : "—") },
                ]}
                rows={data.contracts}
              />
            )}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
