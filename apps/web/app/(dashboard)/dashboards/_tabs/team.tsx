"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../../../lib/api-client";
import { DashboardCenterShell, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";
import { dashboardRangeToQuery } from "../../../../components/dashboard-center/date-range-bar";
import { num, pct } from "../../../../components/dashboard-center/format";
import { AXIS_PROPS, ChartWithTable, DataTable, GRID_PROPS, SectionCard, SINGLE_SERIES, TOOLTIP_STYLE, formatCompact } from "../../../../components/chart-kit";
import { ErrorState } from "../../../../components/ui/error-state";
import { SkeletonCard } from "../../../../components/ui/skeleton";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Modal } from "../../../../components/ui/modal";

interface TeamRow {
  userId: string;
  name: string;
  leadsAdded: number;
  leadsConverted: number;
  leadsLost: number;
  conversionRate?: number;
  conversationsHandled: number;
  emailsSent: number;
}

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
 *  it can fragment a real person across rows on a typo/casing difference. */
interface UpworkSubmitterRow {
  name: string;
  profileName: string;
  bids: number;
  bidsWon: number;
  bidsLost: number;
  bidsInDiscussion: number;
  invites: number;
  invitesAccepted: number;
  invitesWon: number;
  invitesLost: number;
  invitesInDiscussion: number;
}

export function TeamTab() {
  const [dateRange, setDateRange] = useDashboardDateRange();
  const query = dashboardRangeToQuery(dateRange);

  const teamQuery = useQuery({ queryKey: ["dc-team-performance", query], queryFn: () => api.getDashboardTeamPerformance(query) as Promise<TeamRow[]> });
  const team = teamQuery.data ?? [];
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
    bidders.reduce<Record<string, { name: string; bids: number; bidsWon: number; bidsInDiscussion: number; bidsLost: number }>>((acc, r) => {
      const row = acc[r.name] ?? { name: r.name, bids: 0, bidsWon: 0, bidsInDiscussion: 0, bidsLost: 0 };
      row.bids += r.bids;
      row.bidsWon += r.bidsWon;
      row.bidsInDiscussion += r.bidsInDiscussion;
      row.bidsLost += r.bidsLost;
      acc[r.name] = row;
      return acc;
    }, {}),
  ).sort((a, b) => b.bidsWon - a.bidsWon);

  const inviteSummaries = Object.values(
    inviteRecipients.reduce<Record<string, { name: string; invites: number; invitesAccepted: number; invitesWon: number; invitesInDiscussion: number; invitesLost: number }>>(
      (acc, r) => {
        const row = acc[r.name] ?? { name: r.name, invites: 0, invitesAccepted: 0, invitesWon: 0, invitesInDiscussion: 0, invitesLost: 0 };
        row.invites += r.invites;
        row.invitesAccepted += r.invitesAccepted;
        row.invitesWon += r.invitesWon;
        row.invitesInDiscussion += r.invitesInDiscussion;
        row.invitesLost += r.invitesLost;
        acc[r.name] = row;
        return acc;
      },
      {},
    ),
  ).sort((a, b) => b.invitesWon - a.invitesWon);

  const [bidderDetail, setBidderDetail] = useState<string | null>(null);
  const [inviteDetail, setInviteDetail] = useState<string | null>(null);

  return (
    <DashboardCenterShell
      compact
      title="Team Performance Dashboard"
      subtitle="Per-user rollup. Email performance is credited to whoever uploaded the lead (Lead.uploadedByUserId) — there's no per-sender field on EmailMessage — a defensible default, not a tracked fact."
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      onRefresh={() => {
        teamQuery.refetch();
        upworkQuery.refetch();
      }}
      refreshing={teamQuery.isFetching || upworkQuery.isFetching}
    >
      {teamQuery.isLoading && <SkeletonCard className="h-56" />}
      {teamQuery.error && <ErrorState message={(teamQuery.error as Error).message} onRetry={() => teamQuery.refetch()} />}
      {!teamQuery.isLoading && team.length === 0 && <EmptyState title="No active team members with activity in this period" />}

      {team.length > 0 && (
        // Changed from "Leads added per team member" to a general activity
        // ranking (Part: Dashboard Center, 2026-10-20, explicit user
        // request — "change the table from leads per user, to activity per
        // user, means the more a person uses the platform, it will be shown
        // there"). activityScore sums every real per-user action this page
        // already fetches across modules (leads added, social conversations
        // handled, emails sent) rather than leads alone, so someone who's
        // heavily active in the inbox/outreach but adds few leads directly
        // still ranks near the top. A single ranking bar, sorted descending
        // — same "who ranks" convention as Social's "By platform" and
        // Upwork's "By submitter" charts, not a multi-series breakdown.
        <ChartWithTable
          title="Activity per team member"
          subtitle="Leads added + social conversations handled + emails sent, this period — a usage ranking, not a performance judgment"
          expandable
          chart={
            <ResponsiveContainer width="100%" height={Math.max(220, team.length * 40)}>
              <BarChart
                data={[...team]
                  .map((r) => ({ ...r, activityScore: r.leadsAdded + r.conversationsHandled + r.emailsSent }))
                  .sort((a, b) => b.activityScore - a.activityScore)}
                layout="vertical"
                margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
              >
                <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
                <XAxis type="number" allowDecimals={false} {...AXIS_PROPS} tickFormatter={formatCompact} />
                <YAxis type="category" dataKey="name" width={130} {...AXIS_PROPS} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Bar dataKey="activityScore" name="Activity" fill={SINGLE_SERIES} radius={[0, 4, 4, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          }
          table={
            <DataTable
              rowKey={(r) => r.userId}
              rows={team}
              columns={[
                { key: "name", header: "Team member", render: (r) => r.name },
                { key: "leadsAdded", header: "Leads Added", render: (r) => num(r.leadsAdded), numeric: true },
                { key: "leadsConverted", header: "Converted", render: (r) => num(r.leadsConverted), numeric: true },
                { key: "leadsLost", header: "Lost", render: (r) => num(r.leadsLost), numeric: true },
                { key: "conversionRate", header: "Conv. Rate", render: (r) => pct(r.conversionRate), numeric: true },
                { key: "conversationsHandled", header: "Social Convos", render: (r) => num(r.conversationsHandled), numeric: true },
                { key: "emailsSent", header: "Emails Sent", render: (r) => num(r.emailsSent), numeric: true },
              ]}
            />
          }
        />
      )}

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
              { key: "bidsWon", header: "Won", render: (r) => num(r.bidsWon), numeric: true },
              { key: "bidsInDiscussion", header: "In Discussion", render: (r) => num(r.bidsInDiscussion), numeric: true },
              { key: "bidsLost", header: "Lost", render: (r) => num(r.bidsLost), numeric: true },
            ]}
          />
        </SectionCard>
      )}

      <Modal open={bidderDetail !== null} onOpenChange={(open) => !open && setBidderDetail(null)} title={bidderDetail ? `${bidderDetail} — bids by profile` : undefined} contentClassName="w-full max-w-lg">
        {bidderDetail && (
          <DataTable
            rowKey={(r) => r.profileName}
            rows={bidders.filter((r) => r.name === bidderDetail)}
            columns={[
              { key: "profileName", header: "Profile", render: (r) => r.profileName },
              { key: "bids", header: "Bids", render: (r) => num(r.bids), numeric: true },
              { key: "bidsWon", header: "Won", render: (r) => num(r.bidsWon), numeric: true },
              { key: "bidsInDiscussion", header: "In Discussion", render: (r) => num(r.bidsInDiscussion), numeric: true },
              { key: "bidsLost", header: "Lost", render: (r) => num(r.bidsLost), numeric: true },
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
              { key: "invitesAccepted", header: "Accepted", render: (r) => num(r.invitesAccepted), numeric: true },
              { key: "invitesWon", header: "Won", render: (r) => num(r.invitesWon), numeric: true },
              { key: "invitesInDiscussion", header: "In Discussion", render: (r) => num(r.invitesInDiscussion), numeric: true },
              { key: "invitesLost", header: "Lost", render: (r) => num(r.invitesLost), numeric: true },
            ]}
          />
        </SectionCard>
      )}

      <Modal open={inviteDetail !== null} onOpenChange={(open) => !open && setInviteDetail(null)} title={inviteDetail ? `${inviteDetail} — invites by profile` : undefined} contentClassName="w-full max-w-lg">
        {inviteDetail && (
          <DataTable
            rowKey={(r) => r.profileName}
            rows={inviteRecipients.filter((r) => r.name === inviteDetail)}
            columns={[
              { key: "profileName", header: "Profile", render: (r) => r.profileName },
              { key: "invites", header: "Invites", render: (r) => num(r.invites), numeric: true },
              { key: "invitesAccepted", header: "Accepted", render: (r) => num(r.invitesAccepted), numeric: true },
              { key: "invitesWon", header: "Won", render: (r) => num(r.invitesWon), numeric: true },
              { key: "invitesInDiscussion", header: "In Discussion", render: (r) => num(r.invitesInDiscussion), numeric: true },
              { key: "invitesLost", header: "Lost", render: (r) => num(r.invitesLost), numeric: true },
            ]}
          />
        )}
      </Modal>
    </DashboardCenterShell>
  );
}
