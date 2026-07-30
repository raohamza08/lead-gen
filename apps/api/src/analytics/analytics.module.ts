import { Module } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsController } from "./analytics.controller";
import { CampaignsModule } from "../campaigns/campaigns.module";

@Module({
  imports: [CampaignsModule],
  providers: [AnalyticsService],
  controllers: [AnalyticsController],
})
export class AnalyticsModule {}
