import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";

const RECENT_LIMIT = 100;

/**
 * Transactions & Financial History (spec Module B) — LIVE (Part: Upwork
 * API integration — Transactions domain, 2026-10-23). Reads only —
 * UpworkTransactionsSyncWorker/Service own talking to Upwork on a
 * schedule, same split as every other Upwork data domain.
 */
@Injectable()
export class UpworkTransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async listTransactions(orgId: string) {
    const [recent, totalCount, byTypeRaw] = await Promise.all([
      this.prisma.upworkApiTransaction.findMany({
        where: { orgId },
        orderBy: { occurredAt: "desc" },
        take: RECENT_LIMIT,
      }),
      this.prisma.upworkApiTransaction.count({ where: { orgId } }),
      this.prisma.upworkApiTransaction.groupBy({
        by: ["accountingSubtype", "amountCurrency"],
        where: { orgId },
        _count: { _all: true },
      }),
    ]);

    return {
      totalCount,
      countBySubtype: byTypeRaw.map((r) => ({ subtype: r.accountingSubtype, currency: r.amountCurrency, count: r._count._all })),
      recent: recent.map((t) => ({
        id: t.id,
        occurredAt: t.occurredAt,
        type: t.type,
        accountingSubtype: t.accountingSubtype,
        description: t.description,
        amountRaw: t.amountRaw,
        amountCurrency: t.amountCurrency,
        amountDisplay: t.amountDisplay,
        paymentStatus: t.paymentStatus,
      })),
    };
  }
}
