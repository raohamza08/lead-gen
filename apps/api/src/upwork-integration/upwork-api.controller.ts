import { Body, Controller, Delete, Get, Post, Put, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { ModuleAccessGuard } from "../common/guards/module-access.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims, Role } from "@leadgen/types";
import { UpworkApiConnectionService } from "./upwork-api-connection.service";
import { UpworkAgencyProfileService } from "./services/agency-profile.service";
import { UpworkInvitesService } from "./services/invites.service";
import { UpworkBiddingService } from "./services/bidding.service";
import { UpworkConnectsUsageService } from "./services/connects-usage.service";
import { UpworkJobDiscoveryService } from "./services/job-discovery.service";
import { UpworkReportingService } from "./services/reporting.service";
import { UpworkChatMonitoringService } from "./services/chat-monitoring.service";
import { SetOrganizationIdDto } from "./dto/set-organization-id.dto";

/**
 * Standard JwtAuthGuard + RolesGuard + ModuleAccessGuard stack, same as
 * every other module in this app (Part: Upwork API integration, 2026-10-12
 * — replaced an earlier hardcoded-single-email UpworkApiOwnerGuard, explicit
 * user request: "make the module an access option so i can give anyone the
 * access... rather than hardcoding it"). Granted per-person from
 * Settings > Team via upworkApiAccess, same as metaAdsAccess etc. — see
 * that flag's own schema docblock for why it defaults false here, unlike
 * most other module flags. Note the standard ADMIN-bypass still applies
 * (ModuleAccessGuard never gates Role.ADMIN): every admin sees this
 * immediately, same as every other module.
 *
 * connect/disconnect stay ADMIN-only on top of the module flag — same
 * reasoning as MetaAdsController's own connect/disconnect: this is a
 * privileged, org-wide credential action, not a per-user preference.
 */
@Controller("upwork-api")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule("UPWORK_API")
export class UpworkApiController {
  constructor(
    private readonly connection: UpworkApiConnectionService,
    private readonly agencyProfile: UpworkAgencyProfileService,
    private readonly invites: UpworkInvitesService,
    private readonly bidding: UpworkBiddingService,
    private readonly connectsUsage: UpworkConnectsUsageService,
    private readonly jobDiscovery: UpworkJobDiscoveryService,
    private readonly reporting: UpworkReportingService,
    private readonly chatMonitoring: UpworkChatMonitoringService,
  ) {}

  @Get("callback-url")
  getCallbackUrl() {
    return this.connection.getCallbackUrl();
  }

  @Get("connect")
  @Roles(Role.ADMIN)
  connect(@CurrentUser() user: JwtClaims) {
    return this.connection.initiateConnect(user);
  }

  @Get("status")
  getStatus(@CurrentUser() user: JwtClaims) {
    return this.connection.getStatus(user.orgId);
  }

  @Delete("connection")
  @Roles(Role.ADMIN)
  disconnect(@CurrentUser() user: JwtClaims) {
    return this.connection.disconnect(user);
  }

  /** Manual organization-ID override (Part: Upwork API integration,
   *  2026-10-22) — see UpworkApiConnectionService.setOrganizationId's own
   *  docblock for why this exists (Upwork's automatic org-detection is
   *  blocked by a scope this app doesn't have). ADMIN-only, same reasoning
   *  as connect/disconnect: this changes which org every sync/read pulls
   *  data from. */
  @Put("organization-id")
  @Roles(Role.ADMIN)
  setOrganizationId(@CurrentUser() user: JwtClaims, @Body() dto: SetOrganizationIdDto) {
    return this.connection.setOrganizationId(user, dto.organizationId);
  }

  @Get("agency-profile")
  getAgencyProfile(@CurrentUser() user: JwtClaims) {
    return this.agencyProfile.getAgencyProfile(user.orgId);
  }

  @Get("invites")
  listInvites(@CurrentUser() user: JwtClaims) {
    return this.invites.listInvites(user.orgId);
  }

  @Get("proposals")
  listProposals(@CurrentUser() user: JwtClaims) {
    return this.bidding.listProposals(user.orgId);
  }

  @Get("connects-usage")
  getConnectsUsage(@CurrentUser() user: JwtClaims) {
    return this.connectsUsage.getConnectsUsage(user.orgId);
  }

  @Get("jobs/relevant")
  listRelevantJobs(@CurrentUser() user: JwtClaims) {
    return this.jobDiscovery.listRelevantJobs(user.orgId);
  }

  @Get("reports/weekly")
  getWeeklyReport(@CurrentUser() user: JwtClaims) {
    return this.reporting.getReport(user.orgId, "weekly");
  }

  @Get("reports/monthly")
  getMonthlyReport(@CurrentUser() user: JwtClaims) {
    return this.reporting.getReport(user.orgId, "monthly");
  }

  @Get("reports/yearly")
  getYearlyReport(@CurrentUser() user: JwtClaims) {
    return this.reporting.getReport(user.orgId, "yearly");
  }

  @Post("chat-monitoring/scan")
  scanChats(@CurrentUser() user: JwtClaims) {
    return this.chatMonitoring.scanActiveContractsForConcerns(user.orgId);
  }
}
