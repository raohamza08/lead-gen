import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
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
import { CreateConnectPurchaseDto, DashboardRangeQueryDto, LeadsAuditQueryDto, SetBenchmarkDto } from "./dto/dashboard-center.dto";

/** Cross-module BI layer (Part: Dashboard Center, 2026-09-30) — every route
 *  here composes existing services/Prisma queries per-domain rather than
 *  duplicating them; see docs/DASHBOARD_CENTER_PLAN.md for the full
 *  gap-analysis behind what each endpoint can and can't honestly compute.
 *  Restricted to ADMIN/MANAGER for now (spec section 21 wants finer-grained
 *  "employee sees own data" scoping eventually — tracked as Phase 12, not
 *  built yet, so an Employee/Sales Rep simply has no access to this
 *  cross-team view rather than a half-scoped one). */
@Controller("dashboard-center")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.MANAGER)
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
  ) {}

  // ---- Leads ----
  @Get("leads/kpis")
  leadsKpis(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.leads.getKpis(user.orgId, query);
  }
  @Get("leads/source-breakdown")
  leadsSources(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.leads.getSourceBreakdown(user.orgId, query);
  }
  @Get("leads/niche-breakdown")
  leadsNiches(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.leads.getNicheBreakdown(user.orgId, query);
  }
  @Get("leads/audit")
  leadsAudit(@CurrentUser() user: JwtClaims, @Query() query: LeadsAuditQueryDto) {
    return this.leads.getAdditionAudit(user.orgId, query);
  }

  // ---- Email campaigns ----
  @Get("email/kpis")
  emailKpis(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.email.getKpis(user.orgId, query);
  }
  @Get("email/queue")
  emailQueue(@CurrentUser() user: JwtClaims) {
    return this.email.getQueueSnapshot(user.orgId);
  }
  @Get("email/sessions")
  emailSessions(@CurrentUser() user: JwtClaims) {
    return this.email.getRecentSessions(user.orgId);
  }
  @Get("email/stage-funnel")
  emailStageFunnel(@CurrentUser() user: JwtClaims) {
    return this.email.getStageFunnel(user.orgId);
  }
  @Get("email/timeseries")
  emailTimeseries(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.email.getTimeseries(user.orgId, query);
  }

  // ---- Unified inbox ----
  @Get("inbox/accounts")
  inboxAccounts(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.inbox.getAccounts(user.orgId, query);
  }
  @Get("inbox/volume")
  inboxVolume(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.inbox.getVolume(user.orgId, query);
  }
  @Get("inbox/leads-from-email")
  inboxLeads(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.inbox.getLeadsFromEmail(user.orgId, query);
  }

  // ---- Social inbox ----
  @Get("social/kpis")
  socialKpis(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.social.getKpis(user.orgId, query);
  }
  @Get("social/platforms")
  socialPlatforms(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.social.getPlatformBreakdown(user.orgId, query);
  }
  @Get("social/team")
  socialTeam(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.social.getTeamResponseMetrics(user.orgId, query);
  }

  // ---- Upwork ----
  @Get("upwork/kpis")
  upworkKpis(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.upwork.getKpis(user.orgId, query);
  }
  @Get("upwork/monthly")
  upworkMonthly(@CurrentUser() user: JwtClaims) {
    return this.upwork.getMonthlyTable(user.orgId);
  }
  @Get("upwork/submitters")
  upworkSubmitters(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.upwork.getSubmitterBreakdown(user.orgId, query);
  }
  @Get("upwork/connect-purchases")
  listConnectPurchases(@CurrentUser() user: JwtClaims) {
    return this.upwork.listConnectPurchases(user.orgId);
  }
  @Post("upwork/connect-purchases")
  @Roles(Role.ADMIN)
  createConnectPurchase(@CurrentUser() user: JwtClaims, @Body() dto: CreateConnectPurchaseDto) {
    return this.upwork.createConnectPurchase(user.orgId, user.sub, dto);
  }
  @Delete("upwork/connect-purchases/:id")
  @Roles(Role.ADMIN)
  deleteConnectPurchase(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.upwork.deleteConnectPurchase(user.orgId, id);
  }

  // ---- Pipeline ----
  @Get("pipeline/funnel")
  pipelineFunnel(@CurrentUser() user: JwtClaims) {
    return this.pipeline.getFunnel(user.orgId);
  }
  @Get("pipeline/stage-timing")
  pipelineStageTiming(@CurrentUser() user: JwtClaims) {
    return this.pipeline.getStageTiming(user.orgId);
  }
  @Get("pipeline/aging")
  pipelineAging(@CurrentUser() user: JwtClaims) {
    return this.pipeline.getLeadAging(user.orgId);
  }

  // ---- Team performance ----
  @Get("team/performance")
  teamPerformance(@CurrentUser() user: JwtClaims, @Query() query: DashboardRangeQueryDto) {
    return this.team.getPerformance(user.orgId, query);
  }

  // ---- Activity / audit (reuses the existing AuditLogService — see its
  // own docblock; this route is deliberately ADMIN/MANAGER, not the
  // stricter PrimaryAdminGuard-only /admin/audit-logs System Logs page) ----
  @Get("activity")
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

  // ---- Benchmarks ----
  @Get("benchmarks")
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
