import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { DashboardRangeQuery, resolveDashboardRange } from "./dashboard-center.util";
import { LeadsDashboardService } from "./leads-dashboard.service";
import { EmailDashboardService } from "./email-dashboard.service";
import { SocialDashboardService } from "./social-dashboard.service";
import { UpworkDashboardService } from "./upwork-dashboard.service";
import { PipelineDashboardService } from "./pipeline-dashboard.service";
import { TeamDashboardService } from "./team-dashboard.service";
import { MetaAdsAnalyticsService } from "../meta-ads/meta-ads-analytics.service";

/**
 * The Executive Overview — top-line KPIs from every module in one place
 * (Part: Dashboard Center, 2026-09-30). Deliberately composes each domain's
 * already-built getKpis()/getFunnel()/getPerformance() rather than running
 * new queries, so this can never drift from what each dashboard's own page
 * reports. Meta Ads is summed across every connected account for the org
 * (that service's own endpoints are per-account) and reported as
 * `connected: false` rather than zeros when none are connected — a
 * disconnected channel and a quiet one are different claims.
 */
@Injectable()
export class OverviewDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsDashboardService,
    private readonly email: EmailDashboardService,
    private readonly social: SocialDashboardService,
    private readonly upwork: UpworkDashboardService,
    private readonly pipeline: PipelineDashboardService,
    private readonly team: TeamDashboardService,
    private readonly metaAdsAnalytics: MetaAdsAnalyticsService,
  ) {}

  async getSummary(orgId: string, query: DashboardRangeQuery) {
    const { current } = resolveDashboardRange(query);
    const from = current.from.toISOString().slice(0, 10);
    const to = current.to.toISOString().slice(0, 10);

    const [leadsKpis, emailKpis, socialKpis, upworkKpis, pipelineFunnel, teamRows, metaAccounts] = await Promise.all([
      this.leads.getKpis(orgId, query),
      this.email.getKpis(orgId, query),
      this.social.getKpis(orgId, query),
      this.upwork.getKpis(orgId, query),
      this.pipeline.getFunnel(orgId),
      this.team.getPerformance(orgId, query),
      this.prisma.metaAdAccount.findMany({ where: { orgId }, select: { id: true } }),
    ]);

    let metaAds: { connected: boolean; accountCount: number; spend?: number; leads?: number } = {
      connected: false,
      accountCount: 0,
    };
    if (metaAccounts.length > 0) {
      const overviews = await Promise.all(
        metaAccounts.map((a) => this.metaAdsAnalytics.getOverview(orgId, a.id, { from, to }).catch(() => null)),
      );
      const valid = overviews.filter((o): o is NonNullable<typeof o> => o !== null);
      metaAds = {
        connected: true,
        accountCount: metaAccounts.length,
        spend: valid.reduce((s, o) => s + o.current.spend, 0),
        leads: valid.reduce((s, o) => s + (o.current.leads ?? 0), 0),
      };
    }

    return {
      range: { from: current.from, to: current.to },
      leads: {
        total: leadsKpis.totalLeads,
        newLeads: leadsKpis.newLeads,
        newLeadsDeltaPct: leadsKpis.newLeadsDeltaPct,
        conversionRate: leadsKpis.conversionRate,
      },
      email: {
        sent: emailKpis.performance.sent,
        openRate: emailKpis.performance.openRate,
        replyRate: emailKpis.performance.replyRate,
        bounced: emailKpis.performance.bounced,
      },
      social: {
        totalConversations: socialKpis.totalConversations,
        responseRate: socialKpis.responseRate,
      },
      upwork: {
        totalBids: upworkKpis.totalBids,
        clientsWon: upworkKpis.clientsWon,
        conversionRate: upworkKpis.conversionRate,
        connectCostAvailable: upworkKpis.connectCostAvailable,
        connectCost: upworkKpis.connectCost,
      },
      pipeline: {
        total: pipelineFunnel.total,
        won: pipelineFunnel.won,
        lost: pipelineFunnel.lost,
        conversionRate: pipelineFunnel.conversionRate,
      },
      team: {
        activeMembers: teamRows.length,
      },
      metaAds,
    };
  }
}
