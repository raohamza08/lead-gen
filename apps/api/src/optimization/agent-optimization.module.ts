import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module";
import { CampaignsModule } from "../campaigns/campaigns.module";
import { OrganizationModule } from "../organization/organization.module";
import { AgentOptimizationService } from "./agent-optimization.service";
import { AgentOptimizationController } from "./agent-optimization.controller";

@Module({
  imports: [AnalyticsModule, CampaignsModule, OrganizationModule],
  providers: [AgentOptimizationService],
  controllers: [AgentOptimizationController],
})
export class AgentOptimizationModule {}
