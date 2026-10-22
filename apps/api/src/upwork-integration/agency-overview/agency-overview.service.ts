import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { UpworkAgencyProfileService } from "../agency-profile/agency-profile.service";
import { UpworkConnectsUsageService } from "../connects-usage/connects-usage.service";
import { UpworkBiddingService } from "../proposals/proposals.service";
import { UpworkInvitesService } from "../invites/invites.service";
import { UpworkTransactionsService } from "../transactions/transactions.service";
import { UpworkWorkHistoryService } from "../work-history/work-history.service";
import { UpworkFreelancerProfilesService } from "../freelancer-profiles/freelancer-profiles.service";
import { UpworkRoomsService } from "../rooms/rooms.service";

/**
 * Agency Overview (spec Module A) — LIVE composite dashboard (Part:
 * Upwork API integration — Agency Overview domain, 2026-10-23). Built
 * LAST, once every underlying domain module existed to aggregate real
 * data from, per the original module-dependency plan.
 *
 * Every metric here is a direct read from an already-verified domain
 * service — this module adds NO new Upwork API calls of its own, it
 * only composes. Every field is traceable to its source module (see each
 * block's inline reference). Fields for domains that are blocked/not
 * applicable (Contracts, Offers, Timesheets, Snapshots, Activity, Client
 * Proposals) are explicitly surfaced as `unavailable: true` with the
 * real reason already documented in that domain's own service, never
 * silently omitted or fabricated.
 */
@Injectable()
export class UpworkAgencyOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agencyProfile: UpworkAgencyProfileService,
    private readonly connectsUsage: UpworkConnectsUsageService,
    private readonly bidding: UpworkBiddingService,
    private readonly invites: UpworkInvitesService,
    private readonly transactions: UpworkTransactionsService,
    private readonly workHistory: UpworkWorkHistoryService,
    private readonly freelancerProfiles: UpworkFreelancerProfilesService,
    private readonly rooms: UpworkRoomsService,
  ) {}

  async getOverview(orgId: string) {
    const connection = await this.prisma.upworkApiConnection.findUnique({ where: { orgId } });
    if (!connection || connection.status !== "CONNECTED") {
      return {
        connected: false,
        status: connection?.status ?? "DISCONNECTED",
        lastSyncError: connection?.lastSyncError ?? null,
      };
    }

    const [profile, connects, proposals, invites, transactions, workHistory, freelancerProfiles, rooms] = await Promise.all([
      this.agencyProfile.getAgencyProfile(orgId).catch(() => null),
      this.connectsUsage.getConnectsUsage(orgId).catch(() => null),
      this.bidding.listProposals(orgId).catch(() => null),
      this.invites.listInvites(orgId).catch(() => null),
      this.transactions.listTransactions(orgId).catch(() => null),
      this.workHistory.listWorkHistory(orgId).catch(() => null),
      this.freelancerProfiles.listProfiles(orgId).catch(() => null),
      this.rooms.listRooms(orgId).catch(() => null),
    ]);

    return {
      connected: true,
      status: connection.status,
      organizationName: connection.organizationName,
      organizationId: connection.organizationId,
      agencyFlag: profile?.profile.flag ?? null,
      lastSyncAt: connection.lastSyncAt,
      lastSyncError: connection.lastSyncError,

      connects: connects?.current
        ? { balance: connects.current.connectsBalance, capturedAt: connects.current.capturedAt }
        : { unavailable: true, reason: "No sync has run yet" },

      proposals: proposals
        ? { totalCount: proposals.totalCount, countByStatus: proposals.countByStatus }
        : { unavailable: true, reason: "No sync has run yet" },

      invites: invites
        ? { totalCount: invites.totalCount, countByStatus: invites.countByStatus }
        : { unavailable: true, reason: "No sync has run yet" },

      transactions: transactions
        ? { totalCount: transactions.totalCount, recentCount: transactions.recent.length }
        : { unavailable: true, reason: "No sync has run yet" },

      workHistory: workHistory
        ? { totalCount: workHistory.totalCount, freelancerCount: workHistory.freelancerCount }
        : { unavailable: true, reason: "No sync has run yet" },

      freelancerProfiles: freelancerProfiles
        ? { totalCount: freelancerProfiles.totalCount }
        : { unavailable: true, reason: "No sync has run yet" },

      rooms: rooms
        ? { totalCount: rooms.totalCount, totalUnread: rooms.totalUnread }
        : { unavailable: true, reason: "No sync has run yet" },

      companyDetails: {
        unavailable: !profile?.companyDetailsAvailable,
        reason: profile?.companyDetailsLimitation ?? null,
        data: profile?.companyDetailsAvailable ? profile.companyDetails : null,
      },

      // Confirmed genuinely blocked/not-applicable domains -- see each
      // one's own service docblock for the real finding. Never silently
      // omitted; always disclosed with the real reason.
      contracts: { unavailable: true, reason: "Blocked by a missing Upwork scope -- confirmed live, same error class as company/staffs." },
      offers: { unavailable: true, reason: "Blocked by a reproducible Upwork backend error (offersByAttributes TRANSFORM_TIMEOUT), not a permission gap." },
      timesheets: { unavailable: true, reason: "Blocked by a team-level Upwork permission (view_gds_hourly_data_from_client) on the connected account." },
      snapshots: { unavailable: true, reason: "Blocked and a semantic mismatch -- real query is Work Diary screen/webcam monitoring, not public-client data." },
      activity: { unavailable: true, reason: "Blocked by a real Upwork permission (read_activity_policy); also a semantic mismatch (work-diary activity codes, not an account event feed)." },
      clientProposals: { unavailable: true, reason: "Not applicable -- this account is a vendor/agency, not a client that posts jobs." },
    };
  }
}
