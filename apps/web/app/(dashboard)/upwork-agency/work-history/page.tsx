"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard, KpiStrip, StatTile, DataTable } from "../../../../components/chart-kit";
import { UpworkAgencyConnectionGate, UpworkConnectionStatus } from "../../../../components/upwork-agency-connection-gate";

/** Work History (spec Module T). Part: Upwork API integration —
 *  enterprise UI shell, 2026-10-23. */
export default function WorkHistoryPage() {
  const statusQuery = useQuery({ queryKey: ["upwork-api-status"], queryFn: () => api.getUpworkApiStatus() as Promise<UpworkConnectionStatus> });
  const connected = Boolean(statusQuery.data?.connected);

  const workHistoryQuery = useQuery({ queryKey: ["upwork-api-work-history"], queryFn: () => api.getUpworkApiWorkHistory(), enabled: connected });
  const workHistory = workHistoryQuery.data;

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Work History" />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold tracking-tight">Work History</h1>
      <p className="text-xs text-ink/50">Per-contract work history for freelancers with a verified proposal/invite relationship to this agency — never a blanket personal pull.</p>

      <SectionCard title="Contracts">
        {workHistoryQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
        {workHistory && workHistory.totalCount > 0 && (
          <div className="flex flex-col gap-4">
            <KpiStrip>
              <StatTile label="Contracts" value={workHistory.totalCount} />
              <StatTile label="Freelancers covered" value={workHistory.freelancerCount} />
            </KpiStrip>
            <DataTable
              rowKey={(e) => e.id}
              columns={[
                { key: "freelancer", header: "Freelancer", render: (e) => e.freelancerName ?? "—" },
                { key: "title", header: "Contract", render: (e) => <span className="line-clamp-1 max-w-xs">{e.title ?? "—"}</span> },
                { key: "status", header: "Status", render: (e) => e.status ?? "—" },
                { key: "charge", header: "Charged", render: (e) => e.totalCharge ?? "—", numeric: true },
                { key: "feedback", header: "Feedback", render: (e) => (e.feedbackToFreelancerScore != null ? `${e.feedbackToFreelancerScore}★` : "—") },
              ]}
              rows={workHistory.recent}
            />
          </div>
        )}
      </SectionCard>
    </div>
  );
}
