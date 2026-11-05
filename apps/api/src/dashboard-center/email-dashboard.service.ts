import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { buildPerformance } from "../analytics/analytics.math";
import { DashboardRangeQuery, resolveDashboardRange, percentDelta } from "./dashboard-center.util";

@Injectable()
export class EmailDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
  ) {}

  /** Threads an optional campaign scope onto a `Lead` where-filter (Part:
   *  proper Campaign system, 2026-11-05) — every query in this file that
   *  touches EmailMessage/EmailEvent goes through this instead of a bare
   *  `{ orgId }`, so a campaign's dashboard is strictly isolated to its own
   *  leads and a completed campaign's numbers never pick up anything a
   *  later campaign sends. Omitting campaignId preserves the exact
   *  org-wide behavior every existing caller already relies on. */
  private leadWhere(orgId: string, campaignId?: string) {
    return { orgId, ...(campaignId ? { campaignId } : {}) };
  }

  private async performanceForRange(orgId: string, from: Date, to: Date, campaignId?: string) {
    const lead = this.leadWhere(orgId, campaignId);
    const [sent, delivered, opened, clicked, replied, bounced, spamComplaints, unsubscribed, blocked, failed, queued] = await Promise.all([
      this.prisma.emailEvent.count({ where: { eventType: "SENT", occurredAt: { gte: from, lte: to }, message: { lead } } }),
      this.prisma.emailEvent.count({ where: { eventType: "DELIVERED", occurredAt: { gte: from, lte: to }, message: { lead } } }),
      // Verified opens only (Part: 3-minute open verification) -- same rule
      // AnalyticsService.getEmailFunnel already follows, kept consistent here.
      this.prisma.emailMessage.count({ where: { verifiedOpenedAt: { gte: from, lte: to }, lead } }),
      this.prisma.emailEvent.count({ where: { eventType: "CLICKED", occurredAt: { gte: from, lte: to }, message: { lead } } }),
      this.prisma.emailEvent.count({ where: { eventType: "REPLIED", occurredAt: { gte: from, lte: to }, message: { lead } } }),
      this.prisma.emailEvent.count({ where: { eventType: "BOUNCED", occurredAt: { gte: from, lte: to }, message: { lead } } }),
      this.prisma.emailEvent.count({ where: { eventType: "SPAM_COMPLAINT", occurredAt: { gte: from, lte: to }, message: { lead } } }),
      this.prisma.emailEvent.count({ where: { eventType: "UNSUBSCRIBED", occurredAt: { gte: from, lte: to }, message: { lead } } }),
      this.prisma.emailEvent.count({ where: { eventType: "BLOCKED", occurredAt: { gte: from, lte: to }, message: { lead } } }),
      this.prisma.emailMessage.count({ where: { status: "FAILED", createdAt: { gte: from, lte: to }, lead } }),
      this.prisma.emailMessage.count({ where: { status: "QUEUED", createdAt: { gte: from, lte: to }, lead } }),
    ]);

    // meetings/won intentionally omitted here -- those come from PipelineState
    // current stage, not a dated event, so attributing them to "in this date
    // range" would misrepresent when the meeting/win actually happened.
    return buildPerformance({ queued, sent, delivered, opened, clicked, replied, bounced, spamComplaints, unsubscribed, blocked, failed, meetings: 0, won: 0 });
  }

  async getKpis(orgId: string, query: DashboardRangeQuery, campaignId?: string) {
    const { current, previous } = resolveDashboardRange(query);
    const [performance, previousPerformance, totalCampaigns, activeCampaigns] = await Promise.all([
      this.performanceForRange(orgId, current.from, current.to, campaignId),
      previous ? this.performanceForRange(orgId, previous.from, previous.to, campaignId) : Promise.resolve(undefined),
      this.prisma.campaign.count({ where: { orgId } }),
      this.prisma.campaign.count({ where: { orgId, active: true } }),
    ]);

    return {
      range: { from: current.from, to: current.to },
      compareRange: previous ? { from: previous.from, to: previous.to } : null,
      totalCampaigns,
      activeCampaigns,
      performance,
      previousPerformance: previousPerformance ?? undefined,
      deltas: previousPerformance
        ? {
            sent: percentDelta(performance.sent, previousPerformance.sent),
            openRate: percentDelta(performance.openRate, previousPerformance.openRate),
            replyRate: percentDelta(performance.replyRate, previousPerformance.replyRate),
            bounced: percentDelta(performance.bounced, previousPerformance.bounced),
            unsubscribed: percentDelta(performance.unsubscribed, previousPerformance.unsubscribed),
          }
        : null,
    };
  }

  /** Live snapshot, not date-ranged -- "how many leads are sitting in each
   *  state right now" is inherently a current-moment question (Part:
   *  Dashboard Center spec's Queue Analytics section). */
  async getQueueSnapshot(orgId: string, campaignId?: string) {
    const rows = await this.prisma.emailMessage.groupBy({
      by: ["status"],
      where: { lead: this.leadWhere(orgId, campaignId) },
      _count: { _all: true },
    });
    return rows.map((r) => ({ status: r.status, count: r._count._all })).sort((a, b) => b.count - a.count);
  }

  /** Most recent release batches -- SendingSession IS this codebase's "queue"
   *  concept (Part: Dashboard Center gap-analysis), no separate named-queue
   *  entity exists or is needed. */
  async getRecentSessions(orgId: string, limit = 20) {
    return this.prisma.sendingSession.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, status: true, totalLeads: true, successful: true, failed: true, createdAt: true, startedAt: true, completedAt: true },
    });
  }

  /** Reuses the existing, already-correct funnel query rather than
   *  duplicating its raw-SQL de-dup/verified-open logic (Part: Dashboard
   *  Center — "reuse existing data wherever possible"). All-time, not
   *  scoped to the page's date-range filter -- AnalyticsService.
   *  getEmailFunnel doesn't take a range today, and retrofitting date
   *  bounds into its four raw-SQL queries wasn't worth the regression risk
   *  on this revenue-critical, already-tested code for this pass. */
  async getStageFunnel(orgId: string) {
    return this.analytics.getEmailFunnel(orgId);
  }

  async getTimeseries(orgId: string, query: DashboardRangeQuery, campaignId?: string) {
    const { current } = resolveDashboardRange(query);
    const lead = this.leadWhere(orgId, campaignId);
    const rows = await this.prisma.emailEvent.findMany({
      where: { occurredAt: { gte: current.from, lte: current.to }, message: { lead } },
      select: { eventType: true, occurredAt: true },
    });

    const byDate = new Map<string, { sent: number; opened: number; replied: number; bounced: number; unsubscribed: number }>();
    for (const row of rows) {
      const key = row.occurredAt.toISOString().slice(0, 10);
      const bucket = byDate.get(key) ?? { sent: 0, opened: 0, replied: 0, bounced: 0, unsubscribed: 0 };
      if (row.eventType === "SENT") bucket.sent += 1;
      if (row.eventType === "REPLIED") bucket.replied += 1;
      if (row.eventType === "BOUNCED") bucket.bounced += 1;
      if (row.eventType === "UNSUBSCRIBED") bucket.unsubscribed += 1;
      byDate.set(key, bucket);
    }
    // Verified opens use EmailMessage.verifiedOpenedAt, a different table
    // than the event stream above (same reasoning as performanceForRange).
    const opens = await this.prisma.emailMessage.findMany({
      where: { verifiedOpenedAt: { gte: current.from, lte: current.to }, lead },
      select: { verifiedOpenedAt: true },
    });
    for (const o of opens) {
      const key = o.verifiedOpenedAt!.toISOString().slice(0, 10);
      const bucket = byDate.get(key) ?? { sent: 0, opened: 0, replied: 0, bounced: 0, unsubscribed: 0 };
      bucket.opened += 1;
      byDate.set(key, bucket);
    }

    return [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, counts]) => ({ date, ...counts }));
  }
}
