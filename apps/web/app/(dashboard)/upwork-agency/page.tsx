"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api-client";
import { SectionCard, KpiStrip, StatTile } from "../../../components/chart-kit";

/**
 * Agency Overview (spec Module A) — the landing page of the dedicated
 * Upwork Agency workspace (Part: Upwork API integration — enterprise UI
 * shell, 2026-10-23). Pure read of GET /upwork-api/agency-overview,
 * which itself is a pure composition of every other already-verified
 * domain service — this page adds no new data logic, just presentation.
 */
export default function UpworkAgencyOverviewPage() {
  const router = useRouter();
  const overviewQuery = useQuery({
    queryKey: ["upwork-api-agency-overview"],
    queryFn: () => api.getUpworkApiAgencyOverview(),
  });
  const overview = overviewQuery.data;

  if (overviewQuery.isLoading) {
    return <p className="text-sm text-ink/55">Loading…</p>;
  }

  if (!overview?.connected) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold tracking-tight">Agency Overview</h1>
        <SectionCard title="Not connected">
          <p className="text-sm text-ink/55">
            Connect your Upwork agency account to see real data here.{" "}
            <Link href="/settings/upwork-api" className="text-accent underline">
              Go to Connection Settings
            </Link>
            .
          </p>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Agency Overview</h1>
      </div>

      <SectionCard title="Key metrics" subtitle="Click a tile to open that module.">
        <KpiStrip>
          <StatTile
            label="Connects balance"
            value={overview.connects?.unavailable ? "—" : overview.connects?.balance ?? "—"}
            onClick={() => router.push("/upwork-agency/transactions")}
          />
          <StatTile
            label="Proposals"
            value={overview.proposals?.unavailable ? "—" : overview.proposals?.totalCount ?? "—"}
            onClick={() => router.push("/upwork-agency/bidding")}
          />
          <StatTile
            label="Invites"
            value={overview.invites?.unavailable ? "—" : overview.invites?.totalCount ?? "—"}
            onClick={() => router.push("/upwork-agency/invites")}
          />
          <StatTile
            label="Transactions"
            value={overview.transactions?.unavailable ? "—" : overview.transactions?.totalCount ?? "—"}
            onClick={() => router.push("/upwork-agency/transactions")}
          />
          <StatTile
            label="Freelancers tracked"
            value={overview.freelancerProfiles?.unavailable ? "—" : overview.freelancerProfiles?.totalCount ?? "—"}
            onClick={() => router.push("/upwork-agency/freelancers")}
          />
          <StatTile label="Rooms" value={overview.rooms?.unavailable ? "—" : overview.rooms?.totalCount ?? "—"} onClick={() => router.push("/upwork-agency/rooms")} />
        </KpiStrip>
      </SectionCard>

      {overview.agencyFlag && (
        <SectionCard title="Agency identity">
          <p className="text-sm text-ink/70">
            Upwork&apos;s own classification: {Object.entries(overview.agencyFlag).filter(([, v]) => v).map(([k]) => k).join(", ") || "none"}
          </p>
          {overview.lastSyncAt && <p className="mt-1 text-xs text-ink/50">Last sync: {new Date(overview.lastSyncAt).toLocaleString()}</p>}
        </SectionCard>
      )}

      <SectionCard title="Not available" subtitle="Disclosed with the real reason, never silently omitted or fabricated.">
        <div className="flex flex-col gap-1.5">
          {([
            ["Contracts", overview.contracts],
            ["Offers", overview.offers],
            ["Timesheets", overview.timesheets],
            ["Snapshots", overview.snapshots],
            ["Activity", overview.activity],
            ["Client Proposals", overview.clientProposals],
          ] as const).map(([label, info]) => info?.unavailable && (
            <div key={label} className="flex flex-wrap items-baseline gap-2 text-xs">
              <span className="font-medium text-ink/70">{label}:</span>
              <span className="text-ink/50">{info.reason}</span>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
