import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import { OrganizationService } from "./organization.service";
import { UpdateOrgBrandingDto } from "./dto/update-org-branding.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims, Role } from "@leadgen/types";

@Controller("settings/organization")
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrganizationController {
  constructor(private readonly service: OrganizationService) {}

  @Get("branding")
  getBranding(@CurrentUser() user: JwtClaims) {
    return this.service.getBranding(user.orgId);
  }

  @Patch("branding")
  @Roles(Role.ADMIN)
  updateBranding(@CurrentUser() user: JwtClaims, @Body() dto: UpdateOrgBrandingDto) {
    return this.service.updateBranding(user.orgId, dto);
  }
}
