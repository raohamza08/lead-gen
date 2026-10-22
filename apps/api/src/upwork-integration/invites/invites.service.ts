import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";

const RECENT_LIMIT = 50;
/** Real lifecycle statuses on `statusDetails.status` — confirmed live via
 *  introspection (distinct from the coarser "pending"/"terminated" sync
 *  filter, see VENDOR_INVITATION_STATUS_FILTERS in the GraphQL client). */
const INVITE_STATUSES = ["Pending", "Withdrawn", "Declined", "Accepted", "Archived"] as const;

/**
 * Invite tracking — point 2 of the Upwork API application ("Invite
 * tracking"), now LIVE (Part: Upwork API integration — Invites domain,
 * 2026-10-22). Deliberately a separate domain/table/service from Bidding
 * (UpworkBiddingService/UpworkApiProposal) — explicit user requirement:
 * "I want them separate, bids and invites separately."
 *
 * Reads only — UpworkInvitesSyncWorker/Service own talking to Upwork on a
 * schedule, same split as every other Upwork data domain.
 */
@Injectable()
export class UpworkInvitesService {
  constructor(private readonly prisma: PrismaService) {}

  async listInvites(orgId: string) {
    const [counts, recent] = await Promise.all([
      this.prisma.upworkApiInvite.groupBy({
        by: ["status"],
        where: { orgId },
        _count: { _all: true },
      }),
      this.prisma.upworkApiInvite.findMany({
        where: { orgId },
        orderBy: { upworkModifiedAt: "desc" },
        take: RECENT_LIMIT,
      }),
    ]);

    const countByStatus: Record<string, number> = Object.fromEntries(INVITE_STATUSES.map((s) => [s, 0]));
    for (const c of counts) {
      if (c.status) countByStatus[c.status] = c._count._all;
    }

    return {
      countByStatus,
      totalCount: counts.reduce((sum, c) => sum + c._count._all, 0),
      recent: recent.map((i) => ({
        id: i.id,
        context: i.context,
        jobTitle: i.jobTitle,
        clientName: i.clientName,
        freelancerName: i.freelancerName,
        status: i.status,
        invitationLetter: i.invitationLetter,
        acceptanceDuration: i.acceptanceDuration,
        upfrontPaymentPct: i.upfrontPaymentPct,
        upworkCreatedAt: i.upworkCreatedAt,
        upworkModifiedAt: i.upworkModifiedAt,
      })),
    };
  }
}
