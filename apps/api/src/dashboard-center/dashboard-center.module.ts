import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module";
import { MetaAdsModule } from "../meta-ads/meta-ads.module";
import { DashboardCenterController } from "./dashboard-center.controller";
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
  imports: [AnalyticsModule, MetaAdsModule],
  controllers: [DashboardCenterController],
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
