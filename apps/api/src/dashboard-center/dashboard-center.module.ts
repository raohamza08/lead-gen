import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module";
import { MetaAdsModule } from "../meta-ads/meta-ads.module";
import { CampaignsModule } from "../campaigns/campaigns.module";
import { DashboardCenterController } from "./dashboard-center.controller";
import { CampaignDashboardController } from "./campaign-dashboard.controller";
import { LeadsDashboardService } from "./leads-dashboard.service";
import { EmailDashboardService } from "./email-dashboard.service";
import { InboxDashboardService } from "./inbox-dashboard.service";
import { SocialDashboardService } from "./social-dashboard.service";
import { UpworkDashboardService } from "./upwork-dashboard.service";
import { PipelineDashboardService } from "./pipeline-dashboard.service";
import { TeamDashboardService } from "./team-dashboard.service";
import { BenchmarkService } from "./benchmark.service";
import { OverviewDashboardService } from "./overview-dashboard.service";
import { WebsiteAnalyticsDashboardService } from "./website-analytics-dashboard.service";
import { ConnectsDashboardService } from "./connects-dashboard.service";

@Module({
  // CampaignsModule: safe here (not a cycle) -- see
  // CampaignDashboardController's own docblock for why this direction and
  // not the reverse.
  imports: [AnalyticsModule, MetaAdsModule, CampaignsModule],
  controllers: [DashboardCenterController, CampaignDashboardController],
  providers: [
    LeadsDashboardService,
    EmailDashboardService,
    InboxDashboardService,
    SocialDashboardService,
    UpworkDashboardService,
    PipelineDashboardService,
    TeamDashboardService,
    BenchmarkService,
    OverviewDashboardService,
    WebsiteAnalyticsDashboardService,
    ConnectsDashboardService,
  ],
})
export class DashboardCenterModule {}
