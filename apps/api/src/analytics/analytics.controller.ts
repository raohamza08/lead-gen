import { Controller, Get, UseGuards } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims } from "@leadgen/types";

@Controller("analytics")
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get("summary")
  getSummary(@CurrentUser() user: JwtClaims) {
    return this.analyticsService.getSummary(user.orgId);
  }

  @Get("funnel")
  getFunnel(@CurrentUser() user: JwtClaims) {
    return this.analyticsService.getFunnel(user.orgId);
  }
}
