import { createHash } from "crypto";
import { Injectable, Logger } from "@nestjs/common";
import { UpworkApiConnection } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { UpworkGraphQLClient, ConnectUsageTransaction } from "../shared/upwork-graphql.client";
import { UpworkApiConnectionService } from "../connection/upwork-api-connection.service";

/** How far back to backfill on an org's very first sync (no prior
 *  UpworkConnectsTransaction rows) -- 2 years comfortably covers any
 *  realistic agency history without an unbounded fetch. Subsequent syncs
 *  only need a small trailing window, not a full re-backfill. */
const BACKFILL_WINDOW_DAYS = 730;
/** Trailing overlap on an incremental sync, re-fetching a little further
 *  back than the last sync to catch any transaction that posted with a
 *  slightly earlier `createdDateTime` than when it actually became visible
 *  via the API -- re-inserting an already-seen transaction is a harmless
 *  no-op thanks to the @@unique dedupe key, so erring wide here is free. */
const INCREMENTAL_OVERLAP_DAYS = 2;
const PAGE_SIZE = 100;
/** Hard ceiling on pages fetched in one sync tick, so a pathological
 *  history (or a bug in cursor advancement) can't turn one tick into an
 *  unbounded loop hammering Upwork's API. 100 pages * 100/page = 10,000
 *  transactions per org per tick, far beyond any realistic volume. */
const MAX_PAGES_PER_SYNC = 100;

function dedupeKey(t: ConnectUsageTransaction): string {
  const parts = [t.createdDateTime, t.transactionType, t.reason ?? "", t.amount.rawValue, t.jobPost?.jobId ?? ""];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

/**
 * Actual Connects-usage sync logic (Part: Upwork API integration — Connects
 * usage domain, 2026-10-22) — separate from UpworkConnectsSyncWorker the
 * same way MetaAdsSyncService is separate from MetaAdsSyncWorker: this owns
 * "talk to Upwork + upsert into Postgres" for one connection, the worker
 * just owns "loop over every CONNECTED connection and call this."
 *
 * DOES go through UpworkApiConnectionService.getValidAccessToken (Part:
 * real bug fix, 2026-10-22 — found running the first live proposals
 * backfill: decrypting `connection.accessTokenEnc` directly, as this method
 * originally did, never checks or refreshes an expiring token, so every
 * sync after the first ~24h would silently start failing with a 401 the
 * moment the token actually expired. getValidAccessToken already has the
 * real "refresh if within 5 minutes of expiry" logic — this takes the one
 * extra Prisma query that costs over re-decrypting a possibly-stale token,
 * same as every other caller of that method). */
@Injectable()
export class UpworkConnectsSyncService {
  private readonly logger = new Logger(UpworkConnectsSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connection: UpworkApiConnectionService,
    private readonly graphql: UpworkGraphQLClient,
  ) {}

  async syncConnection(connectionRow: UpworkApiConnection): Promise<void> {
    const { accessToken, organizationId } = await this.connection.getValidAccessToken(connectionRow.orgId);

    try {
      await this.syncSnapshot(connectionRow.orgId, accessToken, organizationId);
      await this.syncHistory(connectionRow.orgId, accessToken, organizationId);
      await this.prisma.upworkApiConnection.update({
        where: { id: connectionRow.id },
        data: { lastSyncAt: new Date(), lastSyncError: null },
      });
    } catch (err) {
      const message = (err as Error).message.slice(0, 300);
      this.logger.warn(`Connects sync failed for org ${connectionRow.orgId}: ${message}`);
      await this.prisma.upworkApiConnection.update({
        where: { id: connectionRow.id },
        data: { lastSyncError: message },
      });
      throw err;
    }
  }

  private async syncSnapshot(orgId: string, accessToken: string, organizationId: string | null): Promise<void> {
    const summary = await this.graphql.getConnectsSummary(accessToken, organizationId);
    await this.prisma.upworkConnectsSnapshot.create({
      data: {
        orgId,
        connectsBalance: summary.connectsBalance,
        rolloverBalance: summary.rolloverBalance,
        connectsBalanceFree: summary.connectsBalanceFree,
        connectsBalancePaid: summary.connectsBalancePaid,
      },
    });
  }

  private async syncHistory(orgId: string, accessToken: string, organizationId: string | null): Promise<void> {
    const mostRecent = await this.prisma.upworkConnectsTransaction.findFirst({
      where: { orgId },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true },
    });

    const rangeEnd = new Date().toISOString();
    const rangeStart = mostRecent
      ? new Date(mostRecent.occurredAt.getTime() - INCREMENTAL_OVERLAP_DAYS * 24 * 60 * 60 * 1000).toISOString()
      : new Date(Date.now() - BACKFILL_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

    let after: string | null = null;
    let pages = 0;
    do {
      const page = await this.graphql.getConnectUsageHistoryPage(accessToken, organizationId, rangeStart, rangeEnd, after, PAGE_SIZE);
      if (page.transactions.length) {
        await this.prisma.$transaction(
          page.transactions.map((t) =>
            this.prisma.upworkConnectsTransaction.upsert({
              where: { orgId_dedupeKey: { orgId, dedupeKey: dedupeKey(t) } },
              create: {
                orgId,
                dedupeKey: dedupeKey(t),
                occurredAt: new Date(t.createdDateTime),
                transactionType: t.transactionType,
                reason: t.reason,
                amountRaw: t.amount.rawValue,
                amountCurrency: t.amount.currency,
                amountDisplay: t.amount.displayValue,
                jobId: t.jobPost?.jobId ?? null,
                jobTitle: t.jobPost?.jobTitle ?? null,
              },
              update: {},
            }),
          ),
        );
      }
      after = page.endCursor;
      pages += 1;
      if (!page.hasNextPage) break;
    } while (after && pages < MAX_PAGES_PER_SYNC);
  }
}
