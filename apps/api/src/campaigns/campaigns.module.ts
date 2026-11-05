import { Module } from "@nestjs/common";
import { CampaignsController } from "./campaigns.controller";
import { CampaignsService } from "./campaigns.service";

// Deliberately no DashboardCenterModule import here (Part: proper Campaign
// system, 2026-11-05) -- AnalyticsModule already imports CampaignsModule
// (for the AI Insights panel's use of CampaignsService.performance), and
// DashboardCenterModule imports AnalyticsModule, so this module reaching
// back into DashboardCenterModule would close a 3-module import cycle
// (Analytics -> Campaigns -> DashboardCenter -> Analytics). The campaign
// dashboard endpoint lives in dashboard-center instead (see
// campaign-dashboard.controller.ts there), which can safely import THIS
// module without creating one.
@Module({
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
