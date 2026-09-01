import { Controller, DefaultValuePipe, ForbiddenException, Get, ParseIntPipe, Post, Query, UseGuards } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import { UserAnalyticsService } from "./user-analytics.service";
import { DateRangeName } from "./date-range";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { ModuleAccessGuard } from "../common/guards/module-access.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims, Role } from "@leadgen/types";

/** Callers without team-wide visibility only ever see their own row —
 *  matches the existing @Roles(Role.ADMIN, Role.MANAGER) gate this
 *  controller already uses for AI insights. Enforced here (never trusting
 *  a `userId` query param from a non-privileged caller), not just hidden in
 *  the frontend. */
const canViewTeamAnalytics = (user: JwtClaims) => user.role === Role.ADMIN || user.role === Role.MANAGER;

@Controller("analytics")
@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule("LEAD_GENERATION")
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly userAnalytics: UserAnalyticsService,
  ) {}

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

  /**
   * Resolves the shared range/userId query params for every Lead Upload /
   * Email Performance endpoint below (Part: Lead Upload Analytics / Email
   * Performance / Ignore Groups, 2026-09-01) — one place enforces "a
   * non-admin can only ever request their own userId," so no individual
   * handler can accidentally skip it.
   */
  private resolveScope(
    user: JwtClaims,
    range: DateRangeName | undefined,
    from: string | undefined,
    to: string | undefined,
    userId: string | undefined,
  ) {
    if (userId && userId !== user.sub && !canViewTeamAnalytics(user)) {
      throw new ForbiddenException("You can only view your own analytics");
    }
    return {
      dateRange: this.userAnalytics.resolveRange(range ?? "ALL_TIME", from, to),
      userId,
    };
  }

  @Get("lead-uploads")
  getLeadUploadStats(
    @CurrentUser() user: JwtClaims,
    @Query("range") range?: DateRangeName,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("userId") userId?: string,
  ) {
    const { dateRange, userId: scopedUserId } = this.resolveScope(user, range, from, to, userId);
    return this.userAnalytics.getLeadUploadStats(user.orgId, dateRange, scopedUserId);
  }

  @Get("email-performance")
  getEmailPerformance(
    @CurrentUser() user: JwtClaims,
    @Query("range") range?: DateRangeName,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("userId") userId?: string,
  ) {
    const { dateRange, userId: scopedUserId } = this.resolveScope(user, range, from, to, userId);
    return this.userAnalytics.getEmailPerformance(user.orgId, dateRange, scopedUserId);
  }

  @Get("failure-breakdown")
  getFailureBreakdown(
    @CurrentUser() user: JwtClaims,
    @Query("range") range?: DateRangeName,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.userAnalytics.getFailureBreakdown(user.orgId, this.userAnalytics.resolveRange(range ?? "ALL_TIME", from, to));
  }

  @Get("trends")
  getTrends(
    @CurrentUser() user: JwtClaims,
    @Query("metric") metric: "LEADS_UPLOADED" | "EMAILS_SENT" | "EMAILS_OPENED" | "REPLIES" | "FAILURES",
    @Query("range") range?: DateRangeName,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.userAnalytics.getTrends(user.orgId, this.userAnalytics.resolveRange(range ?? "LAST_30_DAYS", from, to), metric);
  }

  /** Team-wide by default; a caller without team visibility gets back only
   *  their own row (never an error — the same data they'd get from the
   *  "My Statistics" tiles above, just shaped as a one-row table). */
  @Get("user-breakdown")
  getUserBreakdown(
    @CurrentUser() user: JwtClaims,
    @Query("range") range?: DateRangeName,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const dateRange = this.userAnalytics.resolveRange(range ?? "ALL_TIME", from, to);
    const restrictToUserId = canViewTeamAnalytics(user) ? undefined : user.sub;
    return this.userAnalytics.getUserBreakdown(user.orgId, dateRange, restrictToUserId);
  }
}
