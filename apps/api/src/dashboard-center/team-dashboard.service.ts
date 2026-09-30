import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { DashboardRangeQuery, resolveDashboardRange, safeRate } from "./dashboard-center.util";

/**
 * Per-user rollup across every module that captures a real user attribution
 * (Part: Dashboard Center). Open decision recorded in
 * docs/DASHBOARD_CENTER_PLAN.md: email performance has no per-sender-user
 * field anywhere in the schema, so it's credited here to whoever uploaded
 * the lead (`Lead.uploadedByUserId`) — a defensible default, not a
 * discovered fact, and documented as such rather than silently assumed.
 * Upwork's submitter is free text, not a `User` relation, so it's reported
 * separately by name rather than merged into this per-account rollup (see
 * UpworkDashboardService.getSubmitterBreakdown).
 */
@Injectable()
export class TeamDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getPerformance(orgId: string, query: DashboardRangeQuery) {
    const { current } = resolveDashboardRange(query);
    const users = await this.prisma.user.findMany({ where: { orgId, active: true }, select: { id: true, name: true } });

    return Promise.all(
      users.map(async (u) => {
        const leadWhere = { orgId, uploadedByUserId: u.id, createdAt: { gte: current.from, lte: current.to } };
        const [leadsAdded, leadsConverted, leadsLost, conversationsHandled, emailsSent] = await Promise.all([
          this.prisma.lead.count({ where: leadWhere }),
          this.prisma.lead.count({ where: { ...leadWhere, pipelineState: { stage: { in: ["WON", "CLIENT_ONBOARDING"] } } } }),
          this.prisma.lead.count({ where: { ...leadWhere, pipelineState: { stage: "LOST" } } }),
          this.prisma.socialConversation.count({ where: { assignedToUserId: u.id, lastMessageAt: { gte: current.from, lte: current.to } } }),
          this.prisma.emailMessage.count({ where: { lead: { orgId, uploadedByUserId: u.id }, sentAt: { gte: current.from, lte: current.to } } }),
        ]);

        return {
          userId: u.id,
          name: u.name,
          leadsAdded,
          leadsConverted,
          leadsLost,
          conversionRate: safeRate(leadsConverted, leadsAdded),
          conversationsHandled,
          emailsSent,
        };
      }),
    );
  }
}
