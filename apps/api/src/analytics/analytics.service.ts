import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { AnalyticsSummary, FunnelStageCount, PipelineStage } from "@leadgen/types";

/**
 * Backs the Overview dashboard (Part F2). Reads should hit a read replica in
 * production (Part G2) so a dashboard refresh never contends with lead-insert
 * traffic on the primary; this scaffold queries the single configured DB.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(orgId: string): Promise<AnalyticsSummary> {
    const now = new Date();
    const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - 7);
    const startOfMonth = new Date(now); startOfMonth.setDate(now.getDate() - 30);

    const [
      todaysLeads, weeklyLeads, monthlyLeads, verifiedLeads,
      pendingReviews, wonDeals, lostDeals, meetingsBooked, scoreAgg,
    ] = await Promise.all([
      this.prisma.lead.count({ where: { orgId, createdAt: { gte: startOfToday } } }),
      this.prisma.lead.count({ where: { orgId, createdAt: { gte: startOfWeek } } }),
      this.prisma.lead.count({ where: { orgId, createdAt: { gte: startOfMonth } } }),
      this.prisma.lead.count({ where: { orgId, verifiedEmail: true } }),
      this.prisma.pipelineState.count({ where: { stage: PipelineStage.UNDER_REVIEW, lead: { orgId } } }),
      this.prisma.pipelineState.count({ where: { stage: PipelineStage.WON, lead: { orgId } } }),
      this.prisma.pipelineState.count({ where: { stage: PipelineStage.LOST, lead: { orgId } } }),
      this.prisma.pipelineState.count({ where: { stage: PipelineStage.MEETING_BOOKED, lead: { orgId } } }),
      this.prisma.leadScore.aggregate({
        where: { lead: { orgId } },
        _avg: { leadScore: true, aiOpportunityScore: true },
      }),
    ]);

    const duplicateAgg = await this.prisma.extractionRun.aggregate({
      where: { filter: { orgId } },
      _sum: { leadsFound: true, duplicatesSkipped: true },
    });
    const found = duplicateAgg._sum.leadsFound ?? 0;
    const dup = duplicateAgg._sum.duplicatesSkipped ?? 0;

    const tasksWaiting = await this.prisma.pipelineState.count({
      where: {
        lead: { orgId },
        stage: { in: [PipelineStage.WAITING_2_DAYS, PipelineStage.WAITING_1_2_DAYS] },
      },
    });

    return {
      todaysLeads,
      weeklyLeads,
      monthlyLeads,
      verifiedLeads,
      duplicateRate: found > 0 ? Math.round((dup / (found + dup)) * 1000) / 10 : 0,
      avgLeadScore: Math.round(scoreAgg._avg.leadScore ?? 0),
      avgAiOpportunityScore: Math.round(scoreAgg._avg.aiOpportunityScore ?? 0),
      pendingReviews,
      tasksWaiting,
      meetingsBooked,
      wonDeals,
      lostDeals,
      systemErrors: 0, // TODO(Part G6): source from the dead-letter-queue depth metric
    };
  }

  async getFunnel(orgId: string): Promise<FunnelStageCount[]> {
    const stages = Object.values(PipelineStage);
    const counts = await Promise.all(
      stages.map((stage) => this.prisma.pipelineState.count({ where: { stage, lead: { orgId } } })),
    );
    return stages.map((stage, i) => ({ stage, count: counts[i] }));
  }
}
