import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { PipelineStage } from "@leadgen/types";

/** Stages that mean the deal closed successfully. */
const WON_STAGES = [PipelineStage.WON, PipelineStage.CLIENT_ONBOARDING];
/** Stages that mean a meeting happened or the deal went further. */
const MEETING_OR_BEYOND = [
  PipelineStage.MEETING_BOOKED,
  PipelineStage.PROPOSAL_SENT,
  PipelineStage.NEGOTIATION,
  ...WON_STAGES,
];

@Injectable()
export class CampaignsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Per-campaign outcomes — the whole reason campaigns exist. Also the raw
   * material for the AI Insights panel on Analytics: the AnalyticsAgent reads
   * exactly this shape, so it stays a single source of truth rather than a
   * second aggregation query someone has to remember to keep in sync.
   *
   * Counts come from pipeline stage rather than email events, so a lead that
   * replied via LinkedIn or a forwarded introduction still counts. Attributing
   * outcomes only to tracked email opens would systematically undercount the
   * channels that actually close deals.
   */
  async performance(orgId: string) {
    const campaigns = await this.prisma.campaign.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
    });

    return Promise.all(
      campaigns.map(async (campaign) => {
        const where = { orgId, campaignId: campaign.id };
        const [leads, replied, meetings, won, valueAgg] = await Promise.all([
          this.prisma.lead.count({ where }),
          this.prisma.pipelineState.count({
            where: { lead: where, stage: { in: [PipelineStage.REPLIED, ...MEETING_OR_BEYOND] } },
          }),
          this.prisma.pipelineState.count({ where: { lead: where, stage: { in: MEETING_OR_BEYOND } } }),
          this.prisma.pipelineState.count({ where: { lead: where, stage: { in: WON_STAGES } } }),
          this.prisma.leadScore.aggregate({ where: { lead: where }, _sum: { expectedValue: true } }),
        ]);

        const rate = (n: number) => (leads ? Math.round((n / leads) * 1000) / 10 : 0);

        return {
          id: campaign.id,
          name: campaign.name,
          niche: campaign.niche,
          country: campaign.country,
          offer: campaign.offer,
          active: campaign.active,
          targetLeads: campaign.targetLeads,
          leads,
          replied,
          meetings,
          won,
          pipelineValue: Math.round(Number(valueAgg._sum.expectedValue ?? 0)),
          replyRate: rate(replied),
          meetingRate: rate(meetings),
          winRate: rate(won),
        };
      }),
    );
  }
}
