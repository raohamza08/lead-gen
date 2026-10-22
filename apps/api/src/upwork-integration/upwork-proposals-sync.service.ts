import { Injectable, Logger } from "@nestjs/common";
import { UpworkApiConnection } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { EncryptionService } from "../common/crypto/encryption.service";
import { UpworkGraphQLClient, VENDOR_PROPOSAL_STATUSES, VendorProposalNode, VendorProposalStatus } from "./upwork-graphql.client";

const PAGE_SIZE = 100;
/** Hard ceiling on pages fetched per status per sync tick, same safety
 *  reasoning as UpworkConnectsSyncService's own cap — a pathological volume
 *  or a cursor-advancement bug can't turn one tick into an unbounded loop.
 *  100 pages * 100/page = 10,000 proposals per status per tick, already
 *  generous against EurosHub's real largest bucket (Archived: 5,405). */
const MAX_PAGES_PER_STATUS = 100;

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
 * live) — this walks all 8 known statuses every tick. Each status is sorted
 * DESC by modified time and paginated with an early-stop: once a page's
 * proposals are ALL already in our database (by upworkProposalId), that
 * status's walk stops — anything older than that has necessarily been seen
 * on a prior sync, since Upwork always returns newest-modified first. This
 * makes repeat syncs cheap without needing a date filter the API doesn't
 * offer. The very first sync for a status has nothing to stop early on, so
 * it walks up to MAX_PAGES_PER_STATUS pages (a real, one-time backfill).
 */
@Injectable()
export class UpworkProposalsSyncService {
  private readonly logger = new Logger(UpworkProposalsSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly graphql: UpworkGraphQLClient,
  ) {}

  async syncConnection(connection: UpworkApiConnection): Promise<void> {
    const accessToken = this.encryption.decrypt(connection.accessTokenEnc);
    const organizationId = connection.organizationId;

    try {
      for (const status of VENDOR_PROPOSAL_STATUSES) {
        await this.syncStatus(connection.orgId, accessToken, organizationId, status);
      }
      await this.prisma.upworkApiConnection.update({
        where: { id: connection.id },
        data: { lastSyncAt: new Date(), lastSyncError: null },
      });
    } catch (err) {
      const message = (err as Error).message.slice(0, 300);
      this.logger.warn(`Proposals sync failed for org ${connection.orgId}: ${message}`);
      await this.prisma.upworkApiConnection.update({
        where: { id: connection.id },
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

      const existingIds = new Set(
        (
          await this.prisma.upworkApiProposal.findMany({
            where: { orgId, upworkProposalId: { in: page.proposals.map((p) => p.id) } },
            select: { upworkProposalId: true },
          })
        ).map((r) => r.upworkProposalId),
      );
      const allAlreadySeen = page.proposals.every((p) => existingIds.has(p.id));

      await this.prisma.$transaction(page.proposals.map((p) => this.upsertProposal(orgId, p)));

      pages += 1;
      // Early-stop (see class docblock) -- but only once we've actually
      // seen at least one already-known row this status, not on an empty
      // existingIds set from a status that's simply never been synced yet.
      if (allAlreadySeen && existingIds.size > 0) break;
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
