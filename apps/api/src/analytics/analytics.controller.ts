import { Controller, DefaultValuePipe, Get, ParseIntPipe, Post, Query, UseGuards } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { ModuleAccessGuard } from "../common/guards/module-access.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims, Role } from "@leadgen/types";

@Controller("analytics")
@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule("LEAD_GENERATION")
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

  /** Backs the Analytics page's Opened/Replied tabs — row-level, unlike
   *  every other endpoint here which returns only aggregate counts. */
  @Get("emails")
  getEmailList(@CurrentUser() user: JwtClaims, @Query("event") event: "OPENED" | "REPLIED") {
    return this.analyticsService.getEmailList(user.orgId, event);
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

  /** The persisted result of the last run above — what the page loads on
   *  mount, open to any authenticated user in-org same as the other reads. */
  @Get("ai-insights/latest")
  getLatestAiInsights(@CurrentUser() user: JwtClaims) {
    return this.analyticsService.getLatestAiInsights(user.orgId);
  }
}
