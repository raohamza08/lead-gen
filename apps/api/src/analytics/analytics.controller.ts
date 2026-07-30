import { Controller, DefaultValuePipe, Get, ParseIntPipe, Post, Query, UseGuards } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims, Role } from "@leadgen/types";

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

  @Get("email-funnel")
  getEmailFunnel(@CurrentUser() user: JwtClaims) {
    return this.analyticsService.getEmailFunnel(user.orgId);
  }

  @Get("linkedin-funnel")
  getLinkedinFunnel(@CurrentUser() user: JwtClaims) {
    return this.analyticsService.getLinkedinFunnel(user.orgId);
  }

  @Get("revenue-pipeline")
  getRevenuePipeline(@CurrentUser() user: JwtClaims) {
    return this.analyticsService.getRevenuePipeline(user.orgId);
  }

  @Get("cohort-trends")
  getCohortTrends(
    @CurrentUser() user: JwtClaims,
    @Query("days", new DefaultValuePipe(30), ParseIntPipe) days: number,
  ) {
    // The service clamps `days` to 1-365 — an unbounded window would let a
    // query string trigger a full-table scan.
    return this.analyticsService.getCohortTrends(user.orgId, days);
  }

  /** Costs a Claude CLI call, so gated to roles that can already see the
   *  enrichment-cost controls on Settings, not every viewer. */
  @Post("ai-insights")
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER)
  getAiInsights(@CurrentUser() user: JwtClaims) {
    return this.analyticsService.getAiInsights(user.orgId);
  }
}
