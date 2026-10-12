import { Controller, Delete, Get, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { UpworkApiOwnerGuard } from "../common/guards/upwork-api-owner.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims } from "@leadgen/types";
import { UpworkApiConnectionService } from "./upwork-api-connection.service";
import { UpworkAgencyProfileService } from "./services/agency-profile.service";
import { UpworkInvitesService } from "./services/invites.service";
import { UpworkBiddingService } from "./services/bidding.service";
import { UpworkConnectsUsageService } from "./services/connects-usage.service";
import { UpworkJobDiscoveryService } from "./services/job-discovery.service";
import { UpworkReportingService } from "./services/reporting.service";
import { UpworkChatMonitoringService } from "./services/chat-monitoring.service";

/**
 * Every route here sits behind UpworkApiOwnerGuard, not the usual
 * JwtAuthGuard + RolesGuard + ModuleAccessGuard stack — see that guard's
 * own docblock for why (standing decision: hidden from literally everyone
 * but one named account for now, including other ADMIN-role users, until
 * it's deliberately opened up later).
 */
@Controller("upwork-api")
@UseGuards(JwtAuthGuard, UpworkApiOwnerGuard)
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
  connect(@CurrentUser() user: JwtClaims) {
    return this.connection.initiateConnect(user);
  }

  @Get("status")
  getStatus(@CurrentUser() user: JwtClaims) {
    return this.connection.getStatus(user.orgId);
  }

  @Delete("connection")
  disconnect(@CurrentUser() user: JwtClaims) {
    return this.connection.disconnect(user);
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
