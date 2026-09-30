import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { DashboardRangeQuery, resolveDashboardRange, safeDivide, safeRate } from "./dashboard-center.util";

export interface CreateConnectPurchaseInput {
  purchasedAt: string;
  connectsAmount: number;
  totalCost: number;
  currency?: string;
  notes?: string;
}

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
    const { current } = resolveDashboardRange(query);
    const where = { orgId, createdAt: { gte: current.from, lte: current.to } };

    const [totalBids, totalInvites, invitesAccepted, invitesRejected, won, lost, connectsAgg, hasAnyPurchase] = await Promise.all([
      this.prisma.upworkProposal.count({ where: { ...where, type: "BIDDING" } }),
      this.prisma.upworkProposal.count({ where: { ...where, type: "INVITE" } }),
      this.prisma.upworkProposal.count({ where: { ...where, type: "INVITE", status: { in: ["ACCEPTED", "IN_DISCUSSION", "FOLLOW_UP_1", "FOLLOW_UP_2", "WON"] } } }),
      this.prisma.upworkProposal.count({ where: { ...where, type: "INVITE", status: "LOST" } }),
      this.prisma.upworkProposal.count({ where: { ...where, status: "WON" } }),
      this.prisma.upworkProposal.count({ where: { ...where, status: "LOST" } }),
      this.prisma.upworkProposal.aggregate({ where, _sum: { connects: true } }),
      this.prisma.upworkConnectPurchase.count({ where: { orgId } }),
    ]);

    const connectsUsed = connectsAgg._sum.connects ?? 0;
    const costPerConnect = hasAnyPurchase > 0 ? await this.costPerConnectAsOf(orgId, current.to) : undefined;
    const connectCost = costPerConnect !== undefined ? connectsUsed * costPerConnect : undefined;

    return {
      range: { from: current.from, to: current.to },
      totalBids,
      totalInvites,
      invitesAccepted,
      invitesRejected,
      clientsWon: won,
      clientsLost: lost,
      connectsUsed,
      // Every $ figure below is undefined (not 0) until at least one real
      // purchase is on record -- see costPerConnectAsOf's own docblock.
      connectCostAvailable: hasAnyPurchase > 0,
      connectCost,
      costPerBid: connectCost !== undefined ? safeDivide(connectCost, totalBids) : undefined,
      costPerClient: connectCost !== undefined ? safeDivide(connectCost, won) : undefined,
      costPerInvite: connectCost !== undefined ? safeDivide(connectCost, totalInvites) : undefined,
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
    }));
  }
}
