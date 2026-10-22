import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { ModuleAccessGuard } from "../../common/guards/module-access.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequiresModule } from "../../common/decorators/requires-module.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtClaims, Role } from "@leadgen/types";
import { UpworkAgencyProfileService } from "./agency-profile.service";
import { UpdateOrganizationDto } from "./update-organization.dto";

/** Organization & Agency domain (spec Module C) — LIVE for identity fields,
 *  partially blocked for company/staff details (see service's own
 *  docblock). Same guard stack and `upwork-api` route prefix as every other
 *  Upwork sub-controller. Write (`PUT organization`) is ADMIN-only — it
 *  modifies the agency's real Upwork organization record, a privileged,
 *  org-wide, externally-visible action, not a per-user preference. */
@Controller("upwork-api")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule("UPWORK_API")
export class UpworkAgencyProfileController {
  constructor(private readonly agencyProfile: UpworkAgencyProfileService) {}

  @Get("agency-profile")
  getAgencyProfile(@CurrentUser() user: JwtClaims) {
    return this.agencyProfile.getAgencyProfile(user.orgId);
  }

  @Put("organization")
  @Roles(Role.ADMIN)
  updateOrganization(@CurrentUser() user: JwtClaims, @Body() dto: UpdateOrganizationDto) {
    return this.agencyProfile.updateOrganization(user.orgId, dto);
  }
}
