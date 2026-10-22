"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard, KpiStrip, StatTile } from "../../../../components/chart-kit";
import { UpworkAgencyConnectionGate, UpworkConnectionStatus } from "../../../../components/upwork-agency-connection-gate";

/** Organization & Agency (spec Module C). Part: Upwork API integration
 *  — enterprise UI shell, 2026-10-23. */
export default function OrganizationPage() {
  const statusQuery = useQuery({ queryKey: ["upwork-api-status"], queryFn: () => api.getUpworkApiStatus() as Promise<UpworkConnectionStatus> });
  const connected = Boolean(statusQuery.data?.connected);

  const profileQuery = useQuery({
    queryKey: ["upwork-api-agency-profile"],
    queryFn: () => api.getUpworkApiAgencyProfile(),
    enabled: connected,
  });
  const profile = profileQuery.data;

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Organization & Agency" />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold tracking-tight">Organization & Agency</h1>
      <SectionCard title="Identity" subtitle="Real identity fields from Upwork's own organization record.">
        {profileQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
        {profileQuery.error && <p className="text-sm text-bad">{(profileQuery.error as Error).message}</p>}
        {profile && (
          <div className="flex flex-col gap-4">
            <KpiStrip>
              <StatTile label="Account type" value={profile.profile.type ?? "—"} />
              <StatTile label="Upwork classification" value={profile.profile.flag?.agency ? "Agency" : profile.profile.flag?.individual ? "Individual" : "—"} />
              <StatTile label="Active" value={profile.profile.active ? "Yes" : "No"} />
              <StatTile label="Created" value={profile.profile.creationDate ? new Date(profile.profile.creationDate).toLocaleDateString() : "—"} />
            </KpiStrip>
            <div className="text-xs text-ink/50">
              Upwork org ID {profile.profile.id} · legacy type {profile.profile.legacyType ?? "—"}
              {profile.profile.flag && (
                <> · flags: {Object.entries(profile.profile.flag).filter(([, v]) => v).map(([k]) => k).join(", ") || "none"}</>
              )}
            </div>
            {profile.companyDetailsAvailable && profile.companyDetails ? (
              <div className="text-sm text-ink/70">
                Company: {profile.companyDetails.companyName ?? profile.companyDetails.name ?? "—"}
                {profile.companyDetails.city && <> · {profile.companyDetails.city}</>}
                {profile.companyDetails.staffsTotalCount != null && <> · {profile.companyDetails.staffsTotalCount} staff</>}
              </div>
            ) : (
              <div className="rounded-lg border border-[var(--line)] bg-ink/[0.03] px-3 py-2 text-xs text-ink/55">
                Company and staff details are unavailable: {profile.companyDetailsLimitation}
              </div>
            )}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
