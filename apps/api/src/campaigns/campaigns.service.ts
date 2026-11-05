import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { CampaignStatus, NotificationCategory } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { NotificationsService } from "../notifications/notifications.service";
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

/**
 * Campaign lifecycle (Part: proper Campaign system, 2026-11-05) — layered
 * onto the existing read-only `performance()` analytics below, which stays
 * untouched. `active` (the old plain toggle) is left in place on the model
 * for any existing caller, but `status` is now the real source of truth for
 * "is this campaign running" everywhere added here.
 */
@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  /** Public ownership check for callers outside this module (Part: proper
   *  Campaign system, 2026-11-05) -- dashboard-center's campaign-dashboard
   *  endpoint needs this same org-scoped lookup+404 without duplicating it,
   *  but can't inject this whole service's private assertOwned. */
  async getOwned(orgId: string, id: string) {
    return this.assertOwned(orgId, id);
  }

  /** The one place LeadsService (both the AI-discovery and CSV-import
   *  paths) asks "which campaign does a newly-created lead belong to" —
   *  explicit assignment to whichever campaign is actually ACTIVE right
   *  now, replacing the old indirect NicheFilter.filterId inference.
   *  Returns null when nothing is active, which callers treat as "no
   *  campaign" (same as every lead created before campaigns existed). */
  async getActiveCampaign(orgId: string) {
    return this.prisma.campaign.findFirst({ where: { orgId, status: CampaignStatus.ACTIVE } });
  }

  private async assertOwned(orgId: string, id: string) {
    const campaign = await this.prisma.campaign.findFirst({ where: { id, orgId } });
    if (!campaign) throw new NotFoundException("Campaign not found");
    return campaign;
  }

  /** DRAFT or PAUSED -> ACTIVE. Only one campaign can be ACTIVE per org at a
   *  time (the user's explicit choice — simpler scheduling, no capacity-
   *  sharing logic needed) — enforced here, the single place status flips
   *  to ACTIVE, rather than scattered checks at every lead-creation site. */
  async start(orgId: string, id: string) {
    const campaign = await this.assertOwned(orgId, id);
    if (campaign.status === CampaignStatus.COMPLETED) {
      throw new BadRequestException("This campaign already completed — create a new one instead of restarting it.");
    }
    const alreadyActive = await this.prisma.campaign.findFirst({
      where: { orgId, status: CampaignStatus.ACTIVE, id: { not: id } },
    });
    if (alreadyActive) {
      throw new BadRequestException(`"${alreadyActive.name}" is already the active campaign — pause or complete it first.`);
    }
    const updated = await this.prisma.campaign.update({
      where: { id },
      data: { status: CampaignStatus.ACTIVE, startedAt: campaign.startedAt ?? new Date() },
    });
    this.realtime.emitToOrg(orgId, "campaign.updated", { campaignId: id, status: updated.status });
    return updated;
  }

  /** ACTIVE -> PAUSED. Stops new leads/sends from attaching to it without
   *  losing progress — resuming just goes through start() again, which is
   *  still gated by the one-ACTIVE-at-a-time rule above. */
  async pause(orgId: string, id: string) {
    const campaign = await this.assertOwned(orgId, id);
    if (campaign.status !== CampaignStatus.ACTIVE) {
      throw new BadRequestException(`Only an ACTIVE campaign can be paused (this one is ${campaign.status}).`);
    }
    const updated = await this.prisma.campaign.update({ where: { id }, data: { status: CampaignStatus.PAUSED } });
    this.realtime.emitToOrg(orgId, "campaign.updated", { campaignId: id, status: updated.status });
    return updated;
  }

  /** Manual early completion (a human decides to stop it short of target)
   *  — the automatic path is incrementSent() below reaching the target on
   *  its own. Both converge on the same COMPLETED state and completedAt
   *  stamp, since nothing downstream needs to tell them apart. */
  async complete(orgId: string, id: string) {
    const campaign = await this.assertOwned(orgId, id);
    if (campaign.status === CampaignStatus.COMPLETED) return campaign;
    return this.markCompleted(campaign.id, campaign.orgId, campaign.name);
  }

  private async markCompleted(id: string, orgId: string, name: string) {
    const updated = await this.prisma.campaign.update({
      where: { id },
      data: { status: CampaignStatus.COMPLETED, completedAt: new Date() },
    });
    this.realtime.emitToOrg(orgId, "campaign.updated", { campaignId: id, status: updated.status });
    await this.notifications.notify(orgId, {
      category: NotificationCategory.LEADS,
      type: "CAMPAIGN_COMPLETED",
      severity: "WARNING",
      title: "Campaign Completed",
      message: `"${name}" reached its target and is now complete. Its stats are locked — start a new campaign to keep sending.`,
      entityType: "campaign",
      entityId: id,
      actionUrl: `/campaigns/${id}`,
    });
    return updated;
  }

  /** Called from the one place a send actually succeeds
   *  (EmailProviderService.sendMessageNow) with the lead's campaignId, if
   *  it has one — a lead created before campaigns existed has none, and
   *  simply never contributes to any campaign's counter. Auto-completes
   *  the campaign the instant its monthlyEmailTarget is reached, so the
   *  drip scheduler and lead discovery (both of which check
   *  getActiveCampaign) stop targeting it on their very next tick. */
  async incrementSent(campaignId: string) {
    const campaign = await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { totalSent: { increment: 1 } },
    });
    if (campaign.status === CampaignStatus.ACTIVE && campaign.totalSent >= campaign.monthlyEmailTarget) {
      await this.markCompleted(campaign.id, campaign.orgId, campaign.name);
    }
  }

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
          status: campaign.status,
          dailySendTarget: campaign.dailySendTarget,
          monthlyEmailTarget: campaign.monthlyEmailTarget,
          totalSent: campaign.totalSent,
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
