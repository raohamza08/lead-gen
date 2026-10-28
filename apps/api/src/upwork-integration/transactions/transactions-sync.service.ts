import { Injectable, Logger } from "@nestjs/common";
import { UpworkApiConnection } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { UpworkGraphQLClient } from "../shared/upwork-graphql.client";
import { UpworkApiConnectionService } from "../connection/upwork-api-connection.service";

/** 2 years -- comfortably covers any realistic agency history on an org's
 *  very first sync, same reasoning as UpworkConnectsSyncService's own
 *  BACKFILL_WINDOW_DAYS. */
const BACKFILL_WINDOW_DAYS = 730;
/** Trailing overlap on an incremental sync, same reasoning as Connects
 *  usage's own INCREMENTAL_OVERLAP_DAYS -- re-inserting an already-seen
 *  row is a harmless no-op thanks to the @@unique dedupe key. */
const INCREMENTAL_OVERLAP_DAYS = 2;

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Transactions & Financial History sync logic (spec Module B, Part:
 * Upwork API integration — Transactions domain, 2026-10-23) — same split
 * as every other Upwork sync service: this owns "talk to Upwork + upsert
 * into Postgres" for one connection, the worker just loops over every
 * CONNECTED connection and calls this.
 *
 * `transactionHistory` requires a real accounting-entity ID (fetched
 * fresh each tick via `getAccountingEntityId` — confirmed live, no
 * pagination on this query, it returns the full row set for the given
 * date range in one call) and a mandatory date range — there is no
 * "all time" option in the schema, confirmed via introspection. Uses
 * `withFreshTokenOnAuthFailure` from the start, same as every other live
 * sync service.
 */
@Injectable()
export class UpworkTransactionsSyncService {
  private readonly logger = new Logger(UpworkTransactionsSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connection: UpworkApiConnectionService,
    private readonly graphql: UpworkGraphQLClient,
  ) {}

  async syncConnection(connectionRow: UpworkApiConnection): Promise<void> {
    try {
      await this.connection.withFreshTokenOnAuthFailure(connectionRow.orgId, async ({ accessToken, organizationId }) => {
        const accountingEntityId = await this.graphql.getAccountingEntityId(accessToken, organizationId);

        const mostRecent = await this.prisma.upworkApiTransaction.findFirst({
          where: { orgId: connectionRow.orgId },
          orderBy: { occurredAt: "desc" },
          select: { occurredAt: true },
        });
        const rangeEnd = new Date().toISOString();
        const rangeStart = mostRecent?.occurredAt
          ? new Date(mostRecent.occurredAt.getTime() - INCREMENTAL_OVERLAP_DAYS * 24 * 60 * 60 * 1000).toISOString()
          : new Date(Date.now() - BACKFILL_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

        const rows = await this.graphql.getTransactionHistory(accessToken, organizationId, accountingEntityId, rangeStart, rangeEnd);
        if (rows.length) {
          await this.prisma.$transaction(
            rows
              .filter((r) => r.recordId)
              .map((r) => {
                const data = {
                  occurredAt: toDate(r.transactionCreationDate),
                  type: r.type,
                  accountingSubtype: r.accountingSubtype,
                  description: r.description,
                  amountRaw: r.transactionAmount?.rawValue ?? null,
                  amountCurrency: r.transactionAmount?.currency ?? null,
                  amountDisplay: r.transactionAmount?.displayValue ?? null,
                  paymentStatus: r.paymentStatus,
                  assignmentCompanyName: r.assignmentCompanyName,
                  contractId: r.relatedAssignment != null ? String(r.relatedAssignment) : null,
                };
                return this.prisma.upworkApiTransaction.upsert({
                  where: { orgId_upworkRecordId: { orgId: connectionRow.orgId, upworkRecordId: r.recordId! } },
                  create: { orgId: connectionRow.orgId, upworkRecordId: r.recordId!, ...data },
                  update: data,
                });
              }),
          );
        }
      });
      await this.prisma.upworkApiConnection.update({
        where: { id: connectionRow.id },
        data: { lastSyncAt: new Date(), lastSyncError: null },
      });
    } catch (err) {
      const message = (err as Error).message.slice(0, 300);
      this.logger.warn(`Transactions sync failed for org ${connectionRow.orgId}: ${message}`);
      await this.prisma.upworkApiConnection.update({
        where: { id: connectionRow.id },
        data: { lastSyncError: message },
      });
      throw err;
    }
  }
}
