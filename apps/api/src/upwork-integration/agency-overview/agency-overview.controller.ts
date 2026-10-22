import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { ModuleAccessGuard } from "../../common/guards/module-access.guard";
import { RequiresModule } from "../../common/decorators/requires-module.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtClaims } from "@leadgen/types";
import { UpworkAgencyOverviewService } from "./agency-overview.service";

/** Agency Overview domain (spec Module A) — LIVE composite dashboard.
 *  Same guard stack and `upwork-api` route prefix as every other Upwork
 *  sub-controller. */
@Controller("upwork-api")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule("UPWORK_AGENCY_OVERVIEW")
export class UpworkAgencyOverviewController {
  constructor(private readonly agencyOverview: UpworkAgencyOverviewService) {}

  @Get("agency-overview")
  getOverview(@CurrentUser() user: JwtClaims) {
    return this.agencyOverview.getOverview(user.orgId);
  }
}
