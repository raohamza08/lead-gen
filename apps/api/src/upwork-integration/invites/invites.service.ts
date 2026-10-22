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
 *
 * Reconciliation note (Part: Upwork API integration — enterprise module
 * audit, 2026-10-23): the spec's "Vendor Invitations" module also lists
 * top-level `clientInvitationsActive`/`clientInvitation` queries as a
 * candidate data source. Confirmed via introspection these are a
 * DIFFERENT, job-posting-scoped view of the EXACT SAME underlying
 * invitation shape (`ClientInvitation` has the identical id/client/
 * freelancer/jobPosting/invitationLetter/context/statusDetails fields as
 * `VendorInvitation`) — `clientInvitationsActive` requires a specific
 * `jobPostingId` argument, it has no org-wide listing mode. Since this
 * module's `organization.vendorInvitations` source already returns every
 * invitation org-wide with no per-job lookup needed (confirmed live:
 * 352/352 matching Upwork's own count), there is no additional data to
 * gain by also querying `clientInvitationsActive` — it was not built as
 * a separate feature.
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
