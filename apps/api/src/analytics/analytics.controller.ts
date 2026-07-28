import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query, UseGuards } from "@nestjs/common";
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
}
