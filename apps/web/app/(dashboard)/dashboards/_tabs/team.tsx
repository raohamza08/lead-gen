"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { DashboardCenterShell, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";
import { dashboardRangeToQuery } from "../../../../components/dashboard-center/date-range-bar";
import { num } from "../../../../components/dashboard-center/format";
import { DataTable, SectionCard } from "../../../../components/chart-kit";
import { ErrorState } from "../../../../components/ui/error-state";
import { SkeletonCard } from "../../../../components/ui/skeleton";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Modal } from "../../../../components/ui/modal";

/** Upwork bid/invite performance, broken out per submitter+profile (Part:
 *  Dashboard Center, 2026-10-20, explicit user request — "which person did
 *  how many bids, then how many he won, how many his clients are in the in
 *  discussion phase... which person accepts how many invites, how many he
 *  won and how many are in discussion"). Same endpoint the Upwork tab's own
 *  "By submitter" table already uses (getDashboardUpworkSubmitters) — this
 *  is a second read of the same real data, not a new/separate computation,
 *  so the two pages can never disagree. `submittedBy` on UpworkProposal is
 *  free text, not a User relation (see the backend service's own
 *  docblock), so "person" here really means "whatever name was typed in" —
 *  it can fragment a real person across rows on a typo/casing difference.
 *
 *  bidStatusCounts/inviteStatusCounts replace the earlier collapsed
 *  won/lost/in-discussion/accepted fields (explicit user correction —
 *  "remove the accepted status and... add all the current status in the
 *  column heading and then show their numbers so that we have a more clear
 *  report"): one real count per actual UpworkProposalStatus value. */
interface UpworkSubmitterRow {
  name: string;
  profileName: string;
  bids: number;
  bidStatusCounts: Record<string, number>;
  invites: number;
  inviteStatusCounts: Record<string, number>;
}

/** Every UpworkProposalStatus, in schema order, with a human label --
 *  mirrors UpworkDashboardService.PROPOSAL_STATUSES on the backend. VIEWED
 *  is bid-only (Upwork doesn't surface that signal for invites, see the
 *  schema's own comment on the enum), so the invite column set omits it
 *  rather than showing a column that can never have data. WON is labeled
 *  "Client Won" per the same correction above, not just "Won". */
const BID_STATUS_COLUMNS = [
  { key: "SUBMITTED", label: "Submitted" },
  { key: "VIEWED", label: "Viewed" },
  { key: "IN_DISCUSSION", label: "In Discussion" },
  { key: "TEST_TASK", label: "Test Task" },
  { key: "FOLLOW_UP_1", label: "Follow Up 1" },
  { key: "FOLLOW_UP_2", label: "Follow Up 2" },
  { key: "FOLLOW_UP_3", label: "Follow Up 3" },
  { key: "WON", label: "Client Won" },
  { key: "LOST", label: "Lost" },
] as const;
const INVITE_STATUS_COLUMNS = BID_STATUS_COLUMNS.filter((c) => c.key !== "VIEWED");

export function TeamTab() {
  const [dateRange, setDateRange] = useDashboardDateRange();
  const query = dashboardRangeToQuery(dateRange);

  const upworkQuery = useQuery({
    queryKey: ["dc-team-upwork-submitters", query],
    queryFn: () => api.getDashboardUpworkSubmitters(query) as Promise<UpworkSubmitterRow[]>,
  });
  const upwork = upworkQuery.data ?? [];
  const bidders = upwork.filter((r) => r.bids > 0);
  const inviteRecipients = upwork.filter((r) => r.invites > 0);

  // One row per person, not per (person, profile) (Part: Dashboard Center,
  // 2026-10-20, explicit user request after seeing the first version — "I
  // just need a summary... when i want to see the details i just click on
  // it and it pops up with the details"). Summed from the same per-profile
  // rows the modal shows, so the summary can never drift from its own
  // detail view.
  const bidderSummaries = Object.values(
    bidders.reduce<Record<string, { name: string; bids: number; statusCounts: Record<string, number> }>>((acc, r) => {
      const row = acc[r.name] ?? { name: r.name, bids: 0, statusCounts: {} };
      row.bids += r.bids;
      for (const c of BID_STATUS_COLUMNS) row.statusCounts[c.key] = (row.statusCounts[c.key] ?? 0) + (r.bidStatusCounts[c.key] ?? 0);
      acc[r.name] = row;
      return acc;
    }, {}),
  ).sort((a, b) => (b.statusCounts.WON ?? 0) - (a.statusCounts.WON ?? 0));

  const inviteSummaries = Object.values(
    inviteRecipients.reduce<Record<string, { name: string; invites: number; statusCounts: Record<string, number> }>>((acc, r) => {
      const row = acc[r.name] ?? { name: r.name, invites: 0, statusCounts: {} };
      row.invites += r.invites;
      for (const c of INVITE_STATUS_COLUMNS) row.statusCounts[c.key] = (row.statusCounts[c.key] ?? 0) + (r.inviteStatusCounts[c.key] ?? 0);
      acc[r.name] = row;
      return acc;
    }, {}),
  ).sort((a, b) => (b.statusCounts.WON ?? 0) - (a.statusCounts.WON ?? 0));

  const [bidderDetail, setBidderDetail] = useState<string | null>(null);
  const [inviteDetail, setInviteDetail] = useState<string | null>(null);

  return (
    <DashboardCenterShell
      compact
      title="Team Performance Dashboard"
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      onRefresh={() => upworkQuery.refetch()}
      refreshing={upworkQuery.isFetching}
    >
      {upworkQuery.isLoading && <SkeletonCard className="h-32" />}
      {upworkQuery.error && <ErrorState message={(upworkQuery.error as Error).message} onRetry={() => upworkQuery.refetch()} />}
      {!upworkQuery.isLoading && bidders.length === 0 && inviteRecipients.length === 0 && (
        <SectionCard title="Upwork Performance by Person" subtitle="Bidding and invite outcomes, per submitter">
          <EmptyState title="No Upwork bids or invites in this period" />
        </SectionCard>
      )}

      {bidderSummaries.length > 0 && (
        <SectionCard title="Bidding Performance by Person" subtitle="Click a person for their per-profile breakdown" expandable>
          <DataTable
            rowKey={(r) => r.name}
            rows={bidderSummaries}
            columns={[
              {
                key: "name",
                header: "Person",
                render: (r) => (
                  <button type="button" onClick={() => setBidderDetail(r.name)} className="text-accent hover:underline">
                    {r.name}
                  </button>
                ),
              },
              { key: "bids", header: "Bids", render: (r) => num(r.bids), numeric: true },
              ...BID_STATUS_COLUMNS.map((c) => ({
                key: c.key,
                header: c.label,
                render: (r: (typeof bidderSummaries)[number]) => num(r.statusCounts[c.key] ?? 0),
                numeric: true,
              })),
            ]}
          />
        </SectionCard>
      )}

      <Modal open={bidderDetail !== null} onOpenChange={(open) => !open && setBidderDetail(null)} title={bidderDetail ? `${bidderDetail} — bids by profile and status` : undefined} contentClassName="w-full max-w-3xl">
        {bidderDetail && (
          <DataTable
            rowKey={(r) => r.profileName}
            rows={bidders.filter((r) => r.name === bidderDetail)}
            columns={[
              { key: "profileName", header: "Profile", render: (r) => r.profileName },
              { key: "bids", header: "Bids", render: (r) => num(r.bids), numeric: true },
              ...BID_STATUS_COLUMNS.map((c) => ({
                key: c.key,
                header: c.label,
                render: (r: UpworkSubmitterRow) => num(r.bidStatusCounts[c.key] ?? 0),
                numeric: true,
              })),
            ]}
          />
        )}
      </Modal>

      {inviteSummaries.length > 0 && (
        <SectionCard title="Invite Performance by Person" subtitle="Click a person for their per-profile breakdown" expandable>
          <DataTable
            rowKey={(r) => r.name}
            rows={inviteSummaries}
            columns={[
              {
                key: "name",
                header: "Person",
                render: (r) => (
                  <button type="button" onClick={() => setInviteDetail(r.name)} className="text-accent hover:underline">
                    {r.name}
                  </button>
                ),
              },
              { key: "invites", header: "Invites", render: (r) => num(r.invites), numeric: true },
              ...INVITE_STATUS_COLUMNS.map((c) => ({
                key: c.key,
                header: c.label,
                render: (r: (typeof inviteSummaries)[number]) => num(r.statusCounts[c.key] ?? 0),
                numeric: true,
              })),
            ]}
          />
        </SectionCard>
      )}

      <Modal open={inviteDetail !== null} onOpenChange={(open) => !open && setInviteDetail(null)} title={inviteDetail ? `${inviteDetail} — invites by profile and status` : undefined} contentClassName="w-full max-w-3xl">
        {inviteDetail && (
          <DataTable
            rowKey={(r) => r.profileName}
            rows={inviteRecipients.filter((r) => r.name === inviteDetail)}
            columns={[
              { key: "profileName", header: "Profile", render: (r) => r.profileName },
              { key: "invites", header: "Invites", render: (r) => num(r.invites), numeric: true },
              ...INVITE_STATUS_COLUMNS.map((c) => ({
                key: c.key,
                header: c.label,
                render: (r: UpworkSubmitterRow) => num(r.inviteStatusCounts[c.key] ?? 0),
                numeric: true,
              })),
            ]}
          />
        )}
      </Modal>
    </DashboardCenterShell>
  );
}
