"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard, KpiStrip, StatTile, DataTable } from "../../../../components/chart-kit";
import { UpworkAgencyConnectionGate, UpworkConnectionStatus } from "../../../../components/upwork-agency-connection-gate";

/** Freelancer Profiles (spec Module H). Part: Upwork API integration —
 *  enterprise UI shell, 2026-10-23. Agency-scoped: only freelancers with
 *  a verified proposal/invite relationship, never the connected user's
 *  own personal profile. */
export default function FreelancersPage() {
  const statusQuery = useQuery({ queryKey: ["upwork-api-status"], queryFn: () => api.getUpworkApiStatus() as Promise<UpworkConnectionStatus> });
  const connected = Boolean(statusQuery.data?.connected);

  const profilesQuery = useQuery({ queryKey: ["upwork-api-freelancer-profiles"], queryFn: () => api.getUpworkApiFreelancerProfiles(), enabled: connected });
  const profiles = profilesQuery.data;

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Freelancers" />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold tracking-tight">Freelancers</h1>
      <p className="text-xs text-ink/50">Profile aggregates for freelancers with a real, verified relationship to this agency (sourced from proposals/invites).</p>

      <SectionCard title="Freelancer profiles">
        {profilesQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
        {profiles && profiles.totalCount > 0 && (
          <div className="flex flex-col gap-4">
            <KpiStrip>
              <StatTile label="Freelancers tracked" value={profiles.totalCount} />
            </KpiStrip>
            <DataTable
              rowKey={(p) => p.id}
              columns={[
                { key: "name", header: "Name", render: (p) => p.freelancerName ?? "—" },
                { key: "rated", header: "Top Rated", render: (p) => p.topRatedStatus ?? "—" },
                { key: "earnings", header: "Earnings", render: (p) => (p.totalEarnings != null ? `$${p.totalEarnings.toLocaleString()}` : "—"), numeric: true },
                { key: "jobs", header: "Jobs", render: (p) => p.totalJobs ?? "—", numeric: true },
                { key: "skills", header: "Top skills", render: (p) => <span className="line-clamp-1 max-w-xs">{p.skills.slice(0, 4).join(", ") || "—"}</span> },
              ]}
              rows={profiles.profiles}
            />
          </div>
        )}
      </SectionCard>
    </div>
  );
}
