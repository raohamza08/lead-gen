import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { ModuleAccessGuard } from "../common/guards/module-access.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims, Role } from "@leadgen/types";
import { AuditLogService } from "../audit-log/audit-log.service";
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
import { CreateConnectPurchaseDto, DashboardRangeQueryDto, ImportConnectPurchasesDto, LeadsAuditQueryDto, SetBenchmarkDto, SetGaPropertyIdDto } from "./dto/dashboard-center.dto";

/** Cross-module BI layer (Part: Dashboard Center, 2026-09-30) — every route
 *  here composes existing services/Prisma queries per-domain rather than
 *  duplicating them; see docs/DASHBOARD_CENTER_PLAN.md for the full
 *  gap-analysis behind what each endpoint can and can't honestly compute.
 *
 *  Per-tab access (Part: Dashboard Center per-user access, 2026-10-21,
 *  explicit user request — "I want that i got option to show different
 *  dashboard to different persons") — no more class-level @Roles; each read
 *  route below now carries its own @RequiresModule("DASHBOARD_X"), checked
 *  by ModuleAccessGuard against that person's dashboardXAccess flag
 *  (ADMIN always bypasses). Admin-only WRITE routes (connect-purchase
 *  CRUD, GA property, benchmark set/remove) keep their own @Roles(ADMIN) —
 *  viewing a tab and mutating its underlying config are different
 *  privileges, so a dashboard-view grant alone must not unlock those. */
@Controller("dashboard-center")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
export class DashboardCenterController {
  constructor(
    private readonly leads: LeadsDashboardService,
    private readonly email: EmailDashboardService,
    private readonly inbox: InboxDashboardService,
    private readonly social: SocialDashboardService,
    private readonly upwork: UpworkDashboardService,
    private readonly pipeline: PipelineDashboardService,
    private readonly team: TeamDashboardService,
    private readonly benchmarks: BenchmarkService,
    private readonly auditLogs: AuditLogService,
    private readonly overview: OverviewDashboardService,
    private readonly websiteAnalytics: WebsiteAnalyticsDashboardService,
  ) {}

  // ---- Executive Overview ----
  @Get("overview")
  @RequiresModule("DASHBOARD_OVERVIEW")
  overviewSummary(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.overview.getSummary(user.orgId, query);
  }

  // ---- Leads ----
  @Get("leads/kpis")
  @RequiresModule("DASHBOARD_LEADS")
  leadsKpis(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.leads.getKpis(user.orgId, query);
  }
  @Get("leads/source-breakdown")
  @RequiresModule("DASHBOARD_LEADS")
  leadsSources(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.leads.getSourceBreakdown(user.orgId, query);
  }
  @Get("leads/niche-breakdown")
  @RequiresModule("DASHBOARD_LEADS")
  leadsNiches(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.leads.getNicheBreakdown(user.orgId, query);
  }
  @Get("leads/audit")
  @RequiresModule("DASHBOARD_LEADS")
  leadsAudit(@CurrentUser() user: JwtClaims, @Query() query: LeadsAuditQueryDto) {
    return this.leads.getAdditionAudit(user.orgId, query);
  }

  // ---- Email campaigns ----
  @Get("email/kpis")
  @RequiresModule("DASHBOARD_EMAIL")
  emailKpis(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.email.getKpis(user.orgId, query);
  }
  @Get("email/queue")
  @RequiresModule("DASHBOARD_EMAIL")
  emailQueue(@CurrentUser() user: JwtClaims) {
    return this.email.getQueueSnapshot(user.orgId);
  }
  @Get("email/sessions")
  @RequiresModule("DASHBOARD_EMAIL")
  emailSessions(@CurrentUser() user: JwtClaims) {
    return this.email.getRecentSessions(user.orgId);
  }
  @Get("email/stage-funnel")
  @RequiresModule("DASHBOARD_EMAIL")
  emailStageFunnel(@CurrentUser() user: JwtClaims) {
    return this.email.getStageFunnel(user.orgId);
  }
  @Get("email/timeseries")
  @RequiresModule("DASHBOARD_EMAIL")
  emailTimeseries(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.email.getTimeseries(user.orgId, query);
  }

  // ---- Unified inbox ----
  @Get("inbox/accounts")
  @RequiresModule("DASHBOARD_INBOX")
  inboxAccounts(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.inbox.getAccounts(user.orgId, query);
  }
  @Get("inbox/volume")
  @RequiresModule("DASHBOARD_INBOX")
  inboxVolume(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.inbox.getVolume(user.orgId, query);
  }
  @Get("inbox/leads-from-email")
  @RequiresModule("DASHBOARD_INBOX")
  inboxLeads(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.inbox.getLeadsFromEmail(user.orgId, query);
  }

  // ---- Social inbox ----
  @Get("social/kpis")
  @RequiresModule("DASHBOARD_SOCIAL")
  socialKpis(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.social.getKpis(user.orgId, query);
  }
  @Get("social/platforms")
  @RequiresModule("DASHBOARD_SOCIAL")
  socialPlatforms(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.social.getPlatformBreakdown(user.orgId, query);
  }
  @Get("social/team")
  @RequiresModule("DASHBOARD_SOCIAL")
  socialTeam(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.social.getTeamResponseMetrics(user.orgId, query);
  }

  // ---- Upwork ----
  // DASHBOARD_UPWORK replaces the old method-level @Roles widen that let
  // Business Developer see these specific routes (Part: Dashboard Center
  // per-user access, 2026-10-21) — access is now purely the per-user
  // dashboardUpworkAccess flag, seeded true for Business Developers by
  // UsersService's role-default helper, so nothing changes for them today.
  // upwork/submitters also backs the Team tab's own submitter-breakdown
  // tables (see team.tsx), which have no other data source, hence the OR.
  @Get("upwork/kpis")
  @RequiresModule("DASHBOARD_UPWORK")
  upworkKpis(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.upwork.getKpis(user.orgId, query);
  }
  @Get("upwork/monthly")
  @RequiresModule("DASHBOARD_UPWORK")
  upworkMonthly(@CurrentUser() user: JwtClaims) {
    return this.upwork.getMonthlyTable(user.orgId);
  }
  @Get("upwork/submitters")
  @RequiresModule(["DASHBOARD_UPWORK", "DASHBOARD_TEAM"])
  upworkSubmitters(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.upwork.getSubmitterBreakdown(user.orgId, query);
  }
  @Get("upwork/connect-purchases")
  @RequiresModule("DASHBOARD_UPWORK")
  listConnectPurchases(@CurrentUser() user: JwtClaims) {
    return this.upwork.listConnectPurchases(user.orgId);
  }
  @Post("upwork/connect-purchases")
  @Roles(Role.ADMIN)
  createConnectPurchase(@CurrentUser() user: JwtClaims, @Body() dto: CreateConnectPurchaseDto) {
    return this.upwork.createConnectPurchase(user.orgId, user.sub, dto);
  }
  @Post("upwork/connect-purchases/import")
  @Roles(Role.ADMIN)
  importConnectPurchases(@CurrentUser() user: JwtClaims, @Body() dto: ImportConnectPurchasesDto) {
    return this.upwork.importConnectPurchasesFromCsv(user.orgId, user.sub, dto.csv);
  }
  @Delete("upwork/connect-purchases/:id")
  @Roles(Role.ADMIN)
  deleteConnectPurchase(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.upwork.deleteConnectPurchase(user.orgId, id);
  }

  // ---- Pipeline ----
  @Get("pipeline/funnel")
  @RequiresModule("DASHBOARD_PIPELINE")
  pipelineFunnel(@CurrentUser() user: JwtClaims) {
    return this.pipeline.getFunnel(user.orgId);
  }
  @Get("pipeline/stage-timing")
  @RequiresModule("DASHBOARD_PIPELINE")
  pipelineStageTiming(@CurrentUser() user: JwtClaims) {
    return this.pipeline.getStageTiming(user.orgId);
  }
  @Get("pipeline/aging")
  @RequiresModule("DASHBOARD_PIPELINE")
  pipelineAging(@CurrentUser() user: JwtClaims) {
    return this.pipeline.getLeadAging(user.orgId);
  }

  // ---- Team performance ----
  @Get("team/performance")
  @RequiresModule("DASHBOARD_TEAM")
  teamPerformance(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.team.getPerformance(user.orgId, query);
  }

  // ---- Activity / audit (reuses the existing AuditLogService — see its
  // own docblock; this route is deliberately per-user-flag gated, not the
  // stricter PrimaryAdminGuard-only /admin/audit-logs System Logs page) ----
  @Get("activity")
  @RequiresModule("DASHBOARD_ACTIVITY")
  activity(@CurrentUser() user: JwtClaims, @Query() query: Record<string, string>, @Req() req: Request) {
    this.auditLogs.write({ orgId: user.orgId, actorId: user.sub, action: "VIEWED_DASHBOARD_ACTIVITY", entityType: "auditLog", ipAddress: req.ip });
    return this.auditLogs.list(user.orgId, {
      actorId: query.actorId,
      entityType: query.entityType,
      action: query.action,
      search: query.search,
      dateFrom: query.from,
      dateTo: query.to,
      page: Number(query.page) || undefined,
      pageSize: Number(query.pageSize) || undefined,
    });
  }

  // ---- Website Analytics (GA4) ----
  @Get("website-analytics/status")
  @RequiresModule("DASHBOARD_WEBSITE_ANALYTICS")
  websiteAnalyticsStatus(@CurrentUser() user: JwtClaims) {
    return this.websiteAnalytics.getConnectionStatus(user.orgId);
  }
  @Post("website-analytics/property")
  @Roles(Role.ADMIN)
  setGaProperty(@CurrentUser() user: JwtClaims, @Body() dto: SetGaPropertyIdDto) {
    return this.websiteAnalytics.setPropertyId(user.orgId, dto.propertyId);
  }
  @Get("website-analytics/overview")
  @RequiresModule("DASHBOARD_WEBSITE_ANALYTICS")
  websiteAnalyticsOverview(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.websiteAnalytics.getOverview(user.orgId, query);
  }
  @Get("website-analytics/timeseries")
  @RequiresModule("DASHBOARD_WEBSITE_ANALYTICS")
  websiteAnalyticsTimeseries(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.websiteAnalytics.getTimeseries(user.orgId, query);
  }
  @Get("website-analytics/traffic-sources")
  @RequiresModule("DASHBOARD_WEBSITE_ANALYTICS")
  websiteAnalyticsTrafficSources(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.websiteAnalytics.getTrafficSources(user.orgId, query);
  }
  @Get("website-analytics/top-pages")
  @RequiresModule("DASHBOARD_WEBSITE_ANALYTICS")
  websiteAnalyticsTopPages(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.websiteAnalytics.getTopPages(user.orgId, query);
  }
  @Get("website-analytics/audience")
  @RequiresModule("DASHBOARD_WEBSITE_ANALYTICS")
  websiteAnalyticsAudience(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.websiteAnalytics.getAudience(user.orgId, query);
  }

  // ---- Benchmarks ----
  @Get("benchmarks")
  @RequiresModule("DASHBOARD_BENCHMARKS")
  listBenchmarks(@CurrentUser() user: JwtClaims) {
    return this.benchmarks.list(user.orgId);
  }
  @Post("benchmarks")
  @Roles(Role.ADMIN)
  setBenchmark(@CurrentUser() user: JwtClaims, @Body() dto: SetBenchmarkDto) {
    return this.benchmarks.set(user.orgId, user.sub, dto.metricKey, dto.targetValue);
  }
  @Delete("benchmarks/:metricKey")
  @Roles(Role.ADMIN)
  removeBenchmark(@CurrentUser() user: JwtClaims, @Param("metricKey") metricKey: string) {
    return this.benchmarks.remove(user.orgId, metricKey);
  }
}
