import { Injectable, Logger } from "@nestjs/common";
import { UpworkApiConnection } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { UpworkGraphQLClient, VENDOR_PROPOSAL_STATUSES, VendorProposalNode, VendorProposalStatus } from "../shared/upwork-graphql.client";
import { UpworkApiConnectionService } from "../connection/upwork-api-connection.service";

/** `vendorProposals` rejects `first` above some value between 25-50 with a
 *  generic "Input parameter provided has incorrect value" (code VJCA-6) --
 *  confirmed live: 100 and 50 both fail, 25 works. This is a different,
 *  stricter cap than connectUsageHistory's (which accepted 100 fine) -- not
 *  a global pagination limit, specific to this query. Found the hard way:
 *  the first real backfill attempt failed outright on this before any
 *  pagination had a chance to run. */
const PAGE_SIZE = 25;
/** Hard ceiling on pages fetched per status per sync tick, same safety
 *  reasoning as UpworkConnectsSyncService's own cap — a pathological volume
 *  or a cursor-advancement bug can't turn one tick into an unbounded loop.
 *  400 pages * 25/page = 10,000 proposals per status per tick, still
 *  generous against EurosHub's real largest bucket (Archived: 5,405) even
 *  at the smaller page size. */
const MAX_PAGES_PER_STATUS = 400;

function toDate(displayValue: string | undefined | null): Date | null {
  if (!displayValue) return null;
  const d = new Date(displayValue);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Actual Bidding/proposals sync logic (Part: Upwork API integration —
 * Bidding/proposals domain, 2026-10-22) — same split as
 * UpworkConnectsSyncService/Worker: this owns "talk to Upwork + upsert into
 * Postgres" for one connection, the worker just loops over every CONNECTED
 * connection and calls this.
 *
 * Upwork's `vendorProposals` query requires exactly one `status_eq` per
 * call (no "all statuses"/date-range filter exists in the schema, confirmed
 * live) — this walks all 8 known statuses every tick, up to
 * MAX_PAGES_PER_STATUS pages each, every time.
 *
 * Deliberately does NOT early-stop when a page's proposals are all already
 * known locally (an earlier version of this method did, and shipped a real
 * data-loss bug: 2026-10 incidents interrupted several partial syncs
 * mid-walk for some statuses — a 401, a pagination-limit rejection, and a
 * revoked refresh token — leaving small amounts of partial data behind.
 * A later "successful" run's early-stop then matched against that leftover
 * partial data and stopped after 1-2 pages, undercounting badly: e.g.
 * "Hired" stored only 65 rows locally against Upwork's own live totalCount
 * of 3091). A full bounded walk every tick is the only way to guarantee
 * completeness regardless of prior partial-sync history, and Upwork's rate
 * limits comfortably support it (worst case ~574 requests for a full
 * 8-status walk at 25/page, against limits of 300/min and 40k/day).
 *
 * Uses UpworkApiConnectionService.withFreshTokenOnAuthFailure, not a plain
 * getValidAccessToken (Part: real bug fix, 2026-10-22 — same fix as
 * UpworkConnectsSyncService, see that method's own docblock: Upwork's real
 * token lifetime can be shorter than our computed tokenExpiresAt, so a real
 * 401 needs to force a refresh regardless of what our own estimate says).
 * A 401 deep into the 8-status walk re-runs the whole walk on retry --
 * acceptable since every upsert here is idempotent (dedup key = the real
 * Upwork proposal ID), not a correctness risk, just some repeated work.
 *
 * KNOWN UPSTREAM BUG, confirmed live, not fixable client-side (Part: Upwork
 * API integration, 2026-10-22-23): `vendorProposals(filter: {status_eq})`
 * does not reliably filter by the status it claims to. Confirmed two ways:
 * (1) `status_eq: "Declined"` returned `totalCount: 2760` with the first 10
 * nodes' own `status.status` field reading "Activated"/"Accepted" — NOT
 * "Declined" — reproduced identically across two back-to-back calls (not a
 * flake). (2) three separate full 8-status sync runs produced wildly
 * different per-filter page counts each time (e.g. "Withdrawn" fetched 59,
 * then 2700, then 2775 real items across three runs) while a single status
 * queried completely in isolation (outside the 8-status loop) reliably
 * returns its correct, stable `totalCount` every time (Hired: 3091, 3-for-3)
 * — strongly suggesting Upwork's filter resolver is unreliable specifically
 * under this kind of rapid sequential cross-filter querying, not a pure
 * random fluke. `VendorProposalStatusFilterInput`'s enum values are
 * confirmed to syntactically match `VENDOR_PROPOSAL_STATUSES` exactly
 * (Accepted/Declined/Withdrawn/Offered/Activated/Archived/Hired/Pending),
 * ruling out a naming mismatch on our end.
 *
 * Because each upsert stores the proposal's own real `status.status` field
 * (not the filter value used to find it — see upsertProposal below), every
 * row this ever stores has a CORRECT status regardless of this bug. What
 * this bug costs us is COVERAGE, not correctness: walking all 8 (unreliable)
 * filters may not union to the FULL real set of proposals in one tick, so
 * the stored total can legitimately sit below Upwork's true historical
 * count for a while. There is no confirmed workaround — `VendorProposalFilter`
 * has no date-range or "all statuses" alternative (confirmed via
 * introspection: only status_eq, annotations_eq, freelancerId_eq,
 * organizationId_eq, jobPostingIds_any exist). Repeated 6-hourly ticks
 * should still converge toward full coverage over time since upserts are
 * idempotent and every tick samples the (buggy) filters independently, but
 * this is NOT a guaranteed one-pass-complete backfill until Upwork fixes
 * the underlying filter.
 */
@Injectable()
export class UpworkProposalsSyncService {
  private readonly logger = new Logger(UpworkProposalsSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connection: UpworkApiConnectionService,
    private readonly graphql: UpworkGraphQLClient,
  ) {}

  async syncConnection(connectionRow: UpworkApiConnection): Promise<void> {
    try {
      await this.connection.withFreshTokenOnAuthFailure(connectionRow.orgId, async ({ accessToken, organizationId }) => {
        for (const status of VENDOR_PROPOSAL_STATUSES) {
          await this.syncStatus(connectionRow.orgId, accessToken, organizationId, status);
        }
      });
      await this.prisma.upworkApiConnection.update({
        where: { id: connectionRow.id },
        data: { lastSyncAt: new Date(), lastSyncError: null },
      });
    } catch (err) {
      const message = (err as Error).message.slice(0, 300);
      this.logger.warn(`Proposals sync failed for org ${connectionRow.orgId}: ${message}`);
      await this.prisma.upworkApiConnection.update({
        where: { id: connectionRow.id },
        data: { lastSyncError: message },
      });
      throw err;
    }
  }

  private async syncStatus(
    orgId: string,
    accessToken: string,
    organizationId: string | null,
    status: VendorProposalStatus,
  ): Promise<void> {
    let after: string | null = null;
    let pages = 0;
    do {
      const page = await this.graphql.getVendorProposalsPage(accessToken, organizationId, status, after, PAGE_SIZE);
      if (!page.proposals.length) break;

      await this.prisma.$transaction(page.proposals.map((p) => this.upsertProposal(orgId, p)));

      pages += 1;
      after = page.endCursor;
      if (!page.hasNextPage) break;
    } while (after && pages < MAX_PAGES_PER_STATUS);
  }

  private upsertProposal(orgId: string, p: VendorProposalNode) {
    const data = {
      freelancerUserId: p.user?.id ?? null,
      freelancerName: p.user?.name ?? null,
      jobId: p.marketplaceJobPosting?.id ?? null,
      jobTitle: p.marketplaceJobPosting?.content?.title ?? null,
      chargeRateRaw: p.terms?.chargeRate?.rawValue ?? null,
      chargeRateCurrency: p.terms?.chargeRate?.currency ?? null,
      chargeRateDisplay: p.terms?.chargeRate?.displayValue ?? null,
      upfrontPaymentPct: p.terms?.upfrontPaymentPercent ?? null,
      status: p.status?.status ?? "Unknown",
      statusReason: p.status?.reason?.reason ?? null,
      viewedByClient: p.viewedByClient ?? null,
      upworkCreatedAt: toDate(p.auditDetails?.createdDateTime?.displayValue),
      upworkModifiedAt: toDate(p.auditDetails?.modifiedDateTime?.displayValue),
    };
    return this.prisma.upworkApiProposal.upsert({
      where: { orgId_upworkProposalId: { orgId, upworkProposalId: p.id } },
      create: { orgId, upworkProposalId: p.id, ...data },
      update: data,
    });
  }
}
