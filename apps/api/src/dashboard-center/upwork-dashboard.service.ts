import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { DashboardRangeQuery, resolveDashboardRange, safeDivide, safeRate, percentDelta } from "./dashboard-center.util";
import { parseCsvRows } from "../leads/lead-import-mapping";

export interface CreateConnectPurchaseInput {
  purchasedAt: string;
  connectsAmount: number;
  totalCost: number;
  currency?: string;
  notes?: string;
}

/** Upwork's flat per-connect price, as told to the app by the org
 *  (Part: Dashboard Center, 2026-09-30) — Upwork's own API exposes no
 *  pricing data, so this is a real-world fact supplied directly rather than
 *  something computable from any endpoint. Used as the fallback rate for
 *  every connect-cost calculation below when no `UpworkConnectPurchase`
 *  ledger entries exist yet; once real purchases are on record, their
 *  actual weighted-average cost (see `costPerConnectAsOf`) is used instead
 *  since it reflects whatever was actually paid (bulk pricing, promos,
 *  etc.), not just the flat rate. */
const DEFAULT_CONNECT_UNIT_COST_USD = 0.15;

@Injectable()
export class UpworkDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Connect purchase ledger (Part: Dashboard Center — the only source
  // of real Upwork $ cost; see UpworkConnectPurchase's own schema comment
  // for why this must be manually entered rather than assumed) ----

  async listConnectPurchases(orgId: string) {
    return this.prisma.upworkConnectPurchase.findMany({ where: { orgId }, orderBy: { purchasedAt: "desc" } });
  }

  async createConnectPurchase(orgId: string, userId: string, input: CreateConnectPurchaseInput) {
    return this.prisma.upworkConnectPurchase.create({
      data: {
        orgId,
        purchasedAt: new Date(input.purchasedAt),
        connectsAmount: input.connectsAmount,
        totalCost: input.totalCost,
        currency: input.currency ?? "USD",
        notes: input.notes,
        createdByUserId: userId,
      },
    });
  }

  async deleteConnectPurchase(orgId: string, id: string) {
    const row = await this.prisma.upworkConnectPurchase.findFirst({ where: { id, orgId } });
    if (!row) throw new NotFoundException("Connect purchase not found");
    await this.prisma.upworkConnectPurchase.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * Bulk-imports connect purchases straight from Upwork's own "Transaction
   * Report" CSV export (Part: Dashboard Center, 2026-09-30) — only rows
   * with Transaction type "Connects" are fee-deduction rows for a connect
   * purchase; the paired "Payment" rows are the card charge that funded it
   * and aren't a separate purchase. Idempotent by design: each row's real
   * Upwork "Transaction ID" is stored as `sourceTransactionId`, and
   * `skipDuplicates` means re-uploading the same or an overlapping export
   * (e.g. a fresh monthly report that overlaps the last one) never creates
   * duplicate ledger rows.
   */
  async importConnectPurchasesFromCsv(orgId: string, userId: string, csv: string) {
    let rows: Record<string, string>[];
    try {
      rows = parseCsvRows(csv);
    } catch (err) {
      throw new BadRequestException(`Could not parse this file as CSV: ${(err as Error).message}`);
    }

    const connectRows = rows.filter((r) => r["Transaction type"]?.trim() === "Connects");
    if (connectRows.length === 0) {
      throw new BadRequestException(
        'No "Connects" transaction rows found. Expected an Upwork Transaction Report export with a "Transaction type" column.',
      );
    }

    const purchases: {
      orgId: string;
      purchasedAt: Date;
      connectsAmount: number;
      totalCost: number;
      currency: string;
      sourceTransactionId: string;
      createdByUserId: string;
    }[] = [];
    const skipped: { row: number; reason: string }[] = [];

    connectRows.forEach((row, i) => {
      const rowNumber = i + 2; // header + 1-indexed
      const transactionId = row["Transaction ID"]?.trim();
      if (!transactionId) {
        skipped.push({ row: rowNumber, reason: "missing Transaction ID" });
        return;
      }
      const purchasedAt = new Date(row["Date"]);
      if (Number.isNaN(purchasedAt.getTime())) {
        skipped.push({ row: rowNumber, reason: `unparseable date "${row["Date"]}"` });
        return;
      }
      const connectsMatch = /^(\d[\d,]*)\s*Connects/i.exec(row["Transaction summary"]?.trim() ?? "");
      if (!connectsMatch) {
        skipped.push({ row: rowNumber, reason: `couldn't read connects amount from "${row["Transaction summary"]}"` });
        return;
      }
      const connectsAmount = Number(connectsMatch[1].replace(/,/g, ""));
      const amountRaw = Number((row["Amount $"] ?? "").replace(/,/g, ""));
      if (Number.isNaN(amountRaw)) {
        skipped.push({ row: rowNumber, reason: `unparseable amount "${row["Amount $"]}"` });
        return;
      }
      const totalCost = Math.abs(amountRaw);

      purchases.push({
        orgId,
        purchasedAt,
        connectsAmount,
        totalCost,
        currency: row["Currency"]?.trim() || "USD",
        sourceTransactionId: transactionId,
        createdByUserId: userId,
      });
    });

    const result = await this.prisma.upworkConnectPurchase.createMany({ data: purchases, skipDuplicates: true });

    return {
      rowsInFile: rows.length,
      connectRowsFound: connectRows.length,
      imported: result.count,
      alreadyImported: purchases.length - result.count,
      skipped,
    };
  }

  /** Cumulative weighted-average cost per connect, as of `asOf` -- total real
   *  money spent on connects up to that date divided by total connects
   *  bought up to that date (Part: schema comment on UpworkConnectPurchase
   *  explains why this, not per-transaction FIFO, is the chosen method).
   *  `undefined` means literally zero purchases are on record — not a 0
   *  cost, a genuinely unknown one. */
  private async costPerConnectAsOf(orgId: string, asOf: Date): Promise<number | undefined> {
    const agg = await this.prisma.upworkConnectPurchase.aggregate({
      where: { orgId, purchasedAt: { lte: asOf } },
      _sum: { totalCost: true, connectsAmount: true },
    });
    return safeDivide(agg._sum.totalCost ?? 0, agg._sum.connectsAmount ?? 0);
  }

  async getKpis(orgId: string, query: DashboardRangeQuery) {
    const { current, previous } = resolveDashboardRange(query);
    const where = { orgId, createdAt: { gte: current.from, lte: current.to } };

    const [totalBids, totalInvites, invitesAccepted, invitesRejected, won, lost, connectsAgg, hasAnyPurchase, previousWon, previousBids] = await Promise.all([
      this.prisma.upworkProposal.count({ where: { ...where, type: "BIDDING" } }),
      this.prisma.upworkProposal.count({ where: { ...where, type: "INVITE" } }),
      this.prisma.upworkProposal.count({ where: { ...where, type: "INVITE", status: { in: ["ACCEPTED", "IN_DISCUSSION", "FOLLOW_UP_1", "FOLLOW_UP_2", "WON"] } } }),
      this.prisma.upworkProposal.count({ where: { ...where, type: "INVITE", status: "LOST" } }),
      this.prisma.upworkProposal.count({ where: { ...where, status: "WON" } }),
      this.prisma.upworkProposal.count({ where: { ...where, status: "LOST" } }),
      this.prisma.upworkProposal.aggregate({ where, _sum: { connects: true } }),
      this.prisma.upworkConnectPurchase.count({ where: { orgId } }),
      previous ? this.prisma.upworkProposal.count({ where: { orgId, status: "WON", createdAt: { gte: previous.from, lte: previous.to } } }) : Promise.resolve(undefined),
      previous ? this.prisma.upworkProposal.count({ where: { orgId, type: "BIDDING", createdAt: { gte: previous.from, lte: previous.to } } }) : Promise.resolve(undefined),
    ]);

    const connectsUsed = connectsAgg._sum.connects ?? 0;
    // Real purchase history (if any) reflects what was actually paid; the
    // flat $0.15/connect rate is the fallback, not undefined -- see
    // DEFAULT_CONNECT_UNIT_COST_USD's own docblock for why this is now a
    // known fact rather than a genuinely unknown one.
    const actualCostPerConnect = hasAnyPurchase > 0 ? await this.costPerConnectAsOf(orgId, current.to) : undefined;
    const costPerConnect = actualCostPerConnect ?? DEFAULT_CONNECT_UNIT_COST_USD;
    const connectCost = connectsUsed * costPerConnect;

    return {
      range: { from: current.from, to: current.to },
      totalBids,
      totalInvites,
      invitesAccepted,
      invitesRejected,
      clientsWon: won,
      previousClientsWon: previous ? previousWon : undefined,
      clientsWonDeltaPct: previous ? percentDelta(won, previousWon) : null,
      clientsLost: lost,
      connectsUsed,
      previousTotalBids: previous ? previousBids : undefined,
      totalBidsDeltaPct: previous ? percentDelta(totalBids, previousBids) : null,
      // Always available now that a real per-connect rate is known -- see
      // connectCostBasis for whether the figure below reflects actual
      // recorded purchases or the flat fallback rate.
      connectCostAvailable: true,
      connectCostBasis: actualCostPerConnect !== undefined ? "actual_purchases" : "flat_rate_estimate",
      connectUnitCost: costPerConnect,
      connectCost,
      costPerBid: safeDivide(connectCost, totalBids),
      costPerClient: safeDivide(connectCost, won),
      costPerInvite: safeDivide(connectCost, totalInvites),
      bidsPerClient: safeDivide(totalBids, won),
      connectsPerClient: safeDivide(connectsUsed, won),
      avgConnectsPerBid: safeDivide(connectsUsed, totalBids),
      conversionRate: safeRate(won, totalBids + totalInvites),
    };
  }

  async getMonthlyTable(orgId: string, months = 12) {
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    const proposals = await this.prisma.upworkProposal.findMany({
      where: { orgId, createdAt: { gte: since } },
      select: { createdAt: true, type: true, connects: true, status: true },
    });
    const purchases = await this.prisma.upworkConnectPurchase.findMany({ where: { orgId, purchasedAt: { gte: since } } });

    const byMonth = new Map<string, { bids: number; invites: number; connects: number; won: number; purchaseCost: number; purchaseConnects: number }>();
    const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    for (const p of proposals) {
      const key = monthKey(p.createdAt);
      const bucket = byMonth.get(key) ?? { bids: 0, invites: 0, connects: 0, won: 0, purchaseCost: 0, purchaseConnects: 0 };
      if (p.type === "BIDDING") bucket.bids += 1;
      else bucket.invites += 1;
      bucket.connects += p.connects ?? 0;
      if (p.status === "WON") bucket.won += 1;
      byMonth.set(key, bucket);
    }
    for (const pur of purchases) {
      const key = monthKey(pur.purchasedAt);
      const bucket = byMonth.get(key) ?? { bids: 0, invites: 0, connects: 0, won: 0, purchaseCost: 0, purchaseConnects: 0 };
      bucket.purchaseCost += pur.totalCost;
      bucket.purchaseConnects += pur.connectsAmount;
      byMonth.set(key, bucket);
    }

    return [...byMonth.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([month, b]) => ({
        month,
        bids: b.bids,
        invites: b.invites,
        connectsUsed: b.connects,
        clientsWon: b.won,
        connectsPurchased: b.purchaseConnects || undefined,
        purchaseCost: b.purchaseCost || undefined,
        // Estimated at the flat $0.15/connect rate regardless of that
        // month's actual purchases -- a stable, comparable figure month to
        // month, distinct from `purchaseCost` above (what was actually
        // invoiced that month, only present for months with a recorded
        // purchase).
        estimatedUsageCost: b.connects * DEFAULT_CONNECT_UNIT_COST_USD,
        bidsPerClient: safeDivide(b.bids, b.won),
        connectsPerClient: safeDivide(b.connects, b.won),
      }));
  }

  /** Grouped by the free-text submitter name -- UpworkProposal.submittedBy
   *  is deliberately not a User relation (Part: Dashboard Center
   *  gap-analysis confirmed this via the schema's own comment), so this can
   *  fragment a real person into several rows on a typo/casing difference.
   *  Reported as-is rather than silently guessing a canonical mapping. */
  async getSubmitterBreakdown(orgId: string, query: DashboardRangeQuery) {
    const { current } = resolveDashboardRange(query);
    const rows = await this.prisma.upworkProposal.findMany({
      where: { orgId, createdAt: { gte: current.from, lte: current.to } },
      select: { submittedBy: true, type: true, connects: true, status: true },
    });
    const byUser = new Map<string, { name: string; bids: number; invites: number; connects: number; won: number; lost: number }>();
    for (const r of rows) {
      const bucket = byUser.get(r.submittedBy) ?? { name: r.submittedBy, bids: 0, invites: 0, connects: 0, won: 0, lost: 0 };
      if (r.type === "BIDDING") bucket.bids += 1;
      else bucket.invites += 1;
      bucket.connects += r.connects ?? 0;
      if (r.status === "WON") bucket.won += 1;
      if (r.status === "LOST") bucket.lost += 1;
      byUser.set(r.submittedBy, bucket);
    }
    return [...byUser.values()].map((b) => ({
      ...b,
      conversionRate: safeRate(b.won, b.bids + b.invites),
      connectsPerClient: safeDivide(b.connects, b.won),
      estimatedCost: b.connects * DEFAULT_CONNECT_UNIT_COST_USD,
    }));
  }
}
