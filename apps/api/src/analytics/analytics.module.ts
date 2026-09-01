import { Module } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import { UserAnalyticsService } from "./user-analytics.service";
import { AnalyticsController } from "./analytics.controller";
import { CampaignsModule } from "../campaigns/campaigns.module";

@Module({
  imports: [CampaignsModule],
  providers: [AnalyticsService, UserAnalyticsService],
  controllers: [AnalyticsController],
})
export class AnalyticsModule {}
