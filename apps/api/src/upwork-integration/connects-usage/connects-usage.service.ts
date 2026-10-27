import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { sumConnectsByCategory } from "./connects-category.util";

const TREND_DAYS = 30;
const RECENT_TRANSACTIONS_LIMIT = 50;

/**
 * Connects usage monitoring — point 4 of the Upwork API application
 * ("Connects usage monitoring"), now LIVE (Part: Upwork API integration —
 * Connects usage domain, 2026-10-22, first of the 7 data domains built
 * against a confirmed real schema instead of a stub). Reads only — this
 * deliberately does NOT call Upwork's GraphQL API itself; UpworkConnects-
 * SyncWorker/Service own that on a schedule, so a dashboard page load never
 * waits on (or counts against the rate limit of) a live Upwork request.
 */
@Injectable()
export class UpworkConnectsUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async getConnectsUsage(orgId: string) {
    const since = new Date(Date.now() - TREND_DAYS * 24 * 60 * 60 * 1000);

    const [latest, history, recentTransactions, categoryTotals] = await Promise.all([
      this.prisma.upworkConnectsSnapshot.findFirst({ where: { orgId }, orderBy: { capturedAt: "desc" } }),
      this.prisma.upworkConnectsSnapshot.findMany({
        where: { orgId, capturedAt: { gte: since } },
        orderBy: { capturedAt: "asc" },
      }),
      this.prisma.upworkConnectsTransaction.findMany({
        where: { orgId },
        orderBy: { occurredAt: "desc" },
        take: RECENT_TRANSACTIONS_LIMIT,
      }),
      // Category breakdown (Part: Connects usage monitoring, 2026-10-27,
      // explicit user request to separate bidding/invite/profile-boost
      // spend so boosted-profile connects don't get blended into invite
      // expense) -- same TREND_DAYS window as the balance history above,
      // for one consistent "last 30 days" picture on this widget.
      sumConnectsByCategory(this.prisma, orgId, { gte: since }),
    ]);

    return {
      categoryBreakdown: {
        trendDays: TREND_DAYS,
        bidding: categoryTotals.bidding,
        invites: categoryTotals.invite,
        profileBoost: categoryTotals.profileBoost,
        other: categoryTotals.other,
      },
      current: latest
        ? {
            connectsBalance: latest.connectsBalance,
            rolloverBalance: latest.rolloverBalance,
            connectsBalanceFree: latest.connectsBalanceFree,
            connectsBalancePaid: latest.connectsBalancePaid,
            capturedAt: latest.capturedAt,
          }
        : null,
      history: history.map((h) => ({ capturedAt: h.capturedAt, connectsBalance: h.connectsBalance })),
      recentTransactions: recentTransactions.map((t) => ({
        id: t.id,
        occurredAt: t.occurredAt,
        transactionType: t.transactionType,
        reason: t.reason,
        amountDisplay: t.amountDisplay,
        jobId: t.jobId,
        jobTitle: t.jobTitle,
      })),
    };
  }
}
