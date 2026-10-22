import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { VENDOR_PROPOSAL_STATUSES } from "../upwork-graphql.client";

const RECENT_LIMIT = 50;

/**
 * Bidding & proposal data — point 3 of the Upwork API application
 * ("Bidding & proposal data"), now LIVE (Part: Upwork API integration —
 * Bidding/proposals domain, 2026-10-22, second of the 7 data domains built
 * against a confirmed real schema). Not to be confused with UpworkProposal
 * in the existing `upwork` module, which is this app's own internal
 * tracking table, not data pulled from Upwork's API.
 *
 * Reads only — UpworkProposalsSyncWorker/Service own talking to Upwork on a
 * schedule, same split as Connects usage, so a dashboard page load never
 * waits on (or counts against the rate limit of) a live Upwork request
 * across 8 paginated status queries.
 */
@Injectable()
export class UpworkBiddingService {
  constructor(private readonly prisma: PrismaService) {}

  async listProposals(orgId: string) {
    const [counts, recent] = await Promise.all([
      this.prisma.upworkApiProposal.groupBy({
        by: ["status"],
        where: { orgId },
        _count: { _all: true },
      }),
      this.prisma.upworkApiProposal.findMany({
        where: { orgId },
        orderBy: { upworkModifiedAt: "desc" },
        take: RECENT_LIMIT,
      }),
    ]);

    const countByStatus: Record<string, number> = Object.fromEntries(VENDOR_PROPOSAL_STATUSES.map((s) => [s, 0]));
    for (const c of counts) countByStatus[c.status] = c._count._all;

    return {
      countByStatus,
      totalCount: counts.reduce((sum, c) => sum + c._count._all, 0),
      recent: recent.map((p) => ({
        id: p.id,
        jobTitle: p.jobTitle,
        freelancerName: p.freelancerName,
        status: p.status,
        statusReason: p.statusReason,
        chargeRateDisplay: p.chargeRateDisplay,
        viewedByClient: p.viewedByClient,
        upworkCreatedAt: p.upworkCreatedAt,
        upworkModifiedAt: p.upworkModifiedAt,
      })),
    };
  }
}
