import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { ModuleAccessGuard } from "../common/guards/module-access.guard";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims } from "@leadgen/types";
import { CampaignsService } from "../campaigns/campaigns.service";
import { LeadsDashboardService } from "./leads-dashboard.service";
import { EmailDashboardService } from "./email-dashboard.service";
import { DashboardRangeQueryDto } from "./dto/dashboard-center.dto";

/**
 * Isolated per-campaign dashboard (Part: proper Campaign system,
 * 2026-11-05) — a separate controller from DashboardCenterController
 * (which owns the "dashboard-center" route prefix) specifically so this can
 * live at the route a campaign naturally expects, `/campaigns/:id/dashboard`.
 *
 * Lives in dashboard-center/, not campaigns/, on purpose: CampaignsModule
 * must not import DashboardCenterModule (AnalyticsModule already imports
 * CampaignsModule for CampaignsService.performance, and DashboardCenterModule
 * imports AnalyticsModule — reaching back from CampaignsModule into
 * DashboardCenterModule would close that 3-module cycle). This module can
 * safely import CampaignsModule instead, since nothing CampaignsModule
 * depends on ever leads back here.
 *
 * Reuses LeadsDashboardService (already campaignId-aware) and
 * EmailDashboardService (made campaignId-aware alongside this) — one query
 * implementation for "sent/opened/replied/bounced/unsubscribed," not a
 * second one duplicated here.
 */
@Controller("campaigns")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule("LEAD_GENERATION")
export class CampaignDashboardController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly leadsDashboard: LeadsDashboardService,
    private readonly emailDashboard: EmailDashboardService,
  ) {}

  @Get(":id/dashboard")
  async dashboard(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Query() query: DashboardRangeQueryDto) {
    const campaign = await this.campaigns.getOwned(user.orgId, id);
    const [leads, email] = await Promise.all([
      this.leadsDashboard.getKpis(user.orgId, { ...query, campaignId: id }),
      this.emailDashboard.getKpis(user.orgId, query, id),
    ]);
    // Target vs. actual reported plainly, never hidden (Part: Claude-
    // budget-aware drip scheduler, 2026-11-05, explicit user requirement —
    // if Pro-tier Claude capacity can't sustain the daily target, that must
    // be visible here immediately, not discovered weeks in).
    return {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        dailySendTarget: campaign.dailySendTarget,
        monthlyEmailTarget: campaign.monthlyEmailTarget,
        totalSent: campaign.totalSent,
        startedAt: campaign.startedAt,
        completedAt: campaign.completedAt,
      },
      leads,
      email,
    };
  }
}
