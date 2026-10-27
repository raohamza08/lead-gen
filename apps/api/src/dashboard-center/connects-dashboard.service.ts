import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { DashboardRangeQuery, resolveDashboardRange, safeDivide } from "./dashboard-center.util";
import { detailedCategoryForReason, getDetailedCategoryBreakdown, getDailyConnectsTrend, DetailedConnectsCategory } from "../upwork-integration/connects-usage/connects-category.util";

/** Same flat fallback rate as UpworkDashboardService -- see that file's own
 *  docblock on DEFAULT_CONNECT_UNIT_COST_USD for why this is a known fact,
 *  not a guess, when no real purchase ledger exists yet. Duplicated here
 *  (not imported) since it's a plain constant, not worth a cross-service
 *  dependency for one number both already agree on independently. */
const DEFAULT_CONNECT_UNIT_COST_USD = 0.15;

const RECENT_TRANSACTIONS_LIMIT = 300;

/**
 * Connects Dashboard (Part: Connects Dashboard, 2026-10-28, explicit user
 * request: "create a connects dashboard in which we show each and every
 * connect usage, like how much gets spent on bidding, on which profile how
 * many bids, how many connects, how many connects on invites, how many on
 * open for work and etc"). A dedicated BI view on top of the real synced
 * Connects ledger (UpworkConnectsTransaction) -- the Upwork Dashboard tab's
 * Bidding/Invites Stats cards already surface the headline bidding/invite
 * numbers; this tab is the detailed drill-down underneath them, covering
 * every category the ledger actually contains (Open for Work, Proposal
 * Boost, Purchases, Awards), not just the two the other tab cares about.
 *
 * Deliberately gated under the existing DASHBOARD_UPWORK access flag, not a
 * new one -- this is a different lens on the same Upwork data, not a
 * separate module someone would be granted independently of the rest of
 * Upwork reporting.
 *
 * Per-profile breakdown is NOT here: Upwork's connectUsageHistory API
 * never attaches a profile/identity to a transaction (confirmed empirically
 * — jobId/jobTitle are the only attribution it returns), so a true per-
 * profile connects number can only come from the manually-logged
 * UpworkProposal.connects field. The frontend reuses the existing
 * /dashboard-center/upwork/submitters endpoint's data for that, re-grouped
 * by profile alone -- no new backend method for it, and no pretending the
 * real ledger has profile attribution it doesn't.
 */
@Injectable()
export class ConnectsDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  private async costPerConnectAsOf(orgId: string, asOf: Date): Promise<number> {
    const agg = await this.prisma.upworkConnectPurchase.aggregate({
      where: { orgId, purchasedAt: { lte: asOf } },
      _sum: { totalCost: true, connectsAmount: true },
    });
    return safeDivide(agg._sum.totalCost ?? 0, agg._sum.connectsAmount ?? 0) ?? DEFAULT_CONNECT_UNIT_COST_USD;
  }

  async getOverview(orgId: string, query: DashboardRangeQuery) {
    const { current } = resolveDashboardRange(query);
    const costPerConnect = await this.costPerConnectAsOf(orgId, current.to);

    const [categories, latestSnapshot] = await Promise.all([
      getDetailedCategoryBreakdown(this.prisma, orgId, { gte: current.from, lte: current.to }, costPerConnect),
      this.prisma.upworkConnectsSnapshot.findFirst({ where: { orgId }, orderBy: { capturedAt: "desc" } }),
    ]);

    const totalSpend = categories.filter((c) => c.kind === "SPEND").reduce((sum, c) => sum + c.connects, 0);
    const totalSpendCost = categories.filter((c) => c.kind === "SPEND").reduce((sum, c) => sum + c.estimatedCost, 0);
    const totalAdded = categories.filter((c) => c.kind === "CREDIT").reduce((sum, c) => sum + c.connects, 0);

    return {
      range: { from: current.from, to: current.to },
      balance: latestSnapshot
        ? {
            connectsBalance: latestSnapshot.connectsBalance,
            rolloverBalance: latestSnapshot.rolloverBalance,
            connectsBalanceFree: latestSnapshot.connectsBalanceFree,
            connectsBalancePaid: latestSnapshot.connectsBalancePaid,
            capturedAt: latestSnapshot.capturedAt,
          }
        : null,
      connectUnitCost: costPerConnect,
      totalSpend,
      totalSpendCost,
      totalAdded,
      categories,
    };
  }

  async getDailyTrend(orgId: string, query: DashboardRangeQuery) {
    const { current } = resolveDashboardRange(query);
    return getDailyConnectsTrend(this.prisma, orgId, { gte: current.from, lte: current.to });
  }

  async getTransactions(orgId: string, query: DashboardRangeQuery) {
    const { current } = resolveDashboardRange(query);
    const rows = await this.prisma.upworkConnectsTransaction.findMany({
      where: { orgId, occurredAt: { gte: current.from, lte: current.to } },
      orderBy: { occurredAt: "desc" },
      take: RECENT_TRANSACTIONS_LIMIT,
      select: { id: true, occurredAt: true, transactionType: true, reason: true, amountDisplay: true, jobId: true, jobTitle: true },
    });
    return rows.map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt,
      transactionType: r.transactionType,
      reason: r.reason,
      category: detailedCategoryForReason(r.reason) as DetailedConnectsCategory,
      amountDisplay: r.amountDisplay,
      jobId: r.jobId,
      jobTitle: r.jobTitle,
    }));
  }
}
