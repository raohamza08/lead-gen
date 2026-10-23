import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { PrimaryAdminGuard } from "../../common/guards/primary-admin.guard";
import { RequiresPrimaryAdmin } from "../../common/decorators/requires-primary-admin.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtClaims } from "@leadgen/types";
import { UpworkAgencyToolsService } from "./agency-tools.service";

/** Primary-admin-only (not the standard ModuleAccessGuard/per-user flag
 *  system every other Upwork route uses) — explicit user request,
 *  2026-10-23: "keep it to me for now, I'll see later whom to give
 *  access... do not change any [access] settings". Same gating as
 *  /admin/audit-logs. */
@Controller("upwork-api/agency-tools")
@UseGuards(JwtAuthGuard, PrimaryAdminGuard)
@RequiresPrimaryAdmin()
export class UpworkAgencyToolsController {
  constructor(private readonly tools: UpworkAgencyToolsService) {}

  @Get("organizations")
  listOrganizations(@CurrentUser() user: JwtClaims) {
    return this.tools.listOrganizations(user.orgId);
  }

  @Get("talent-search")
  searchTalent(@CurrentUser() user: JwtClaims, @Query("keyword") keyword = "", @Query("first") first?: string, @Query("after") after?: string) {
    return this.tools.searchTalent(user.orgId, keyword, Number(first) || 20, after ?? null);
  }

  @Get("work-diary/contracts")
  listContracts(@CurrentUser() user: JwtClaims) {
    return this.tools.listContractsForWorkDiary(user.orgId);
  }

  @Get("work-diary")
  getWorkDiary(@CurrentUser() user: JwtClaims, @Query("contractId") contractId: string, @Query("date") date: string) {
    return this.tools.getWorkDiary(user.orgId, contractId, date);
  }

  @Post("invite-to-team")
  inviteToTeam(@CurrentUser() user: JwtClaims, @Body() body: { email: string; targetOrganizationId: string; landingUrl: string }) {
    return this.tools.inviteToTeam(user.orgId, body.email, body.targetOrganizationId, body.landingUrl);
  }
}
