import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { ModuleAccessGuard } from "../common/guards/module-access.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims, Role } from "@leadgen/types";
import { UpworkRequestService } from "./upwork-request.service";
import { CreateUpworkRequestDto } from "./dto/create-upwork-request.dto";
import { UpdateUpworkRequestDto } from "./dto/update-upwork-request.dto";
import { ReviewUpworkRequestDto } from "./dto/review-upwork-request.dto";
import { QueryUpworkRequestsDto } from "./dto/query-upwork-requests.dto";
import { QueryUpworkWeekDto } from "./dto/query-upwork-week.dto";
import { AuditLogService } from "../audit-log/audit-log.service";

/**
 * Project Manager hour requests, inside the Upwork Proposal module (Part:
 * Upwork Requests, 2026-10-01 — "add a new Requests tab inside the Upwork
 * Proposal module"). Gated by its OWN module flag (upworkRequestsAccess),
 * independent of Bidding/Invite access (Part: Upwork Requests, 2026-10-01,
 * explicit user request — "not everyone needs everything... the request tab
 * will be shown to some person [while] I want to hide bidding and invites
 * for them") — see UpworkProposalAccessGuard for how Bidding/Invite enforce
 * their own, separate flags. Individual actions are further restricted by
 * role below (creation -> Project Manager/Admin, review -> Business
 * Developer/Admin).
 *
 * Static sub-paths (profiles, weekly-target, achievement, dashboard-summary)
 * are declared before the `:id` route so Nest's router doesn't swallow them
 * as an id lookup.
 */
@Controller("upwork/requests")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule("UPWORK_REQUESTS")
export class UpworkRequestController {
  constructor(
    private readonly requests: UpworkRequestService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Every authenticated user with Upwork access reads this — it's what
   *  populates the profile picker on the request form, already filtered to
   *  what this specific person is allowed to request against. */
  @Get("profiles")
  listProfiles(@CurrentUser() user: JwtClaims) {
    return this.requests.listAvailableProfiles(user.orgId, user.sub);
  }

  @Get("weekly-target")
  weeklyTarget(@CurrentUser() user: JwtClaims, @Query() query: QueryUpworkWeekDto) {
    return this.requests.getWeeklyTarget(user.orgId, user.sub, user.role, query);
  }

  @Get("achievement")
  achievement(@CurrentUser() user: JwtClaims, @Query() query: QueryUpworkWeekDto) {
    return this.requests.getAchievement(user.orgId, user.sub, user.role, query);
  }

  /** Org-wide summary for the Upwork Dashboard's Requests section — cross-PM
   *  visibility, so restricted the same way the Dashboard Center itself is. */
  @Get("dashboard-summary")
  @Roles(Role.ADMIN, Role.MANAGER, Role.BUSINESS_DEVELOPER)
  dashboardSummary(@CurrentUser() user: JwtClaims, @Query() query: QueryUpworkWeekDto) {
    return this.requests.getDashboardSummary(user.orgId, query);
  }

  @Get()
  findAll(@CurrentUser() user: JwtClaims, @Query() query: QueryUpworkRequestsDto) {
    return this.requests.findAll(user.orgId, user.sub, user.role, query);
  }

  @Get(":id")
  findOne(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.requests.findOne(user.orgId, user.sub, user.role, id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.PROJECT_MANAGER)
  async create(@CurrentUser() user: JwtClaims, @Body() dto: CreateUpworkRequestDto) {
    const request = await this.requests.create(user.orgId, user.sub, dto);
    this.auditLog.write({ orgId: user.orgId, actorId: user.sub, action: "UPWORK_REQUEST_CREATED", entityType: "upworkRequest", entityId: request.id, metadata: { status: request.status } });
    return request;
  }

  @Patch(":id")
  update(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: UpdateUpworkRequestDto) {
    return this.requests.update(user.orgId, user.sub, user.role, id, dto);
  }

  @Patch(":id/submit")
  @Roles(Role.ADMIN, Role.PROJECT_MANAGER)
  submit(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.requests.submit(user.orgId, user.sub, id);
  }

  @Patch(":id/review")
  @Roles(Role.ADMIN, Role.BUSINESS_DEVELOPER)
  async review(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: ReviewUpworkRequestDto) {
    const updated = await this.requests.review(user.orgId, user.sub, id, dto);
    this.auditLog.write({ orgId: user.orgId, actorId: user.sub, action: "UPWORK_REQUEST_REVIEWED", entityType: "upworkRequest", entityId: id, metadata: { status: updated.status } });
    return updated;
  }

  @Delete(":id")
  remove(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.requests.remove(user.orgId, user.sub, user.role, id);
  }
}
