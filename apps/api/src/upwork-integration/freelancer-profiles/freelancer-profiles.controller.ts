import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { ModuleAccessGuard } from "../../common/guards/module-access.guard";
import { RequiresModule } from "../../common/decorators/requires-module.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtClaims } from "@leadgen/types";
import { UpworkFreelancerProfilesService } from "./freelancer-profiles.service";

/** Freelancer Profiles domain (spec Module H) — LIVE. Same guard stack
 *  and `upwork-api` route prefix as every other Upwork sub-controller. */
@Controller("upwork-api")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule("UPWORK_AGENCY_FREELANCERS")
export class UpworkFreelancerProfilesController {
  constructor(private readonly freelancerProfiles: UpworkFreelancerProfilesService) {}

  @Get("freelancer-profiles")
  listProfiles(@CurrentUser() user: JwtClaims) {
    return this.freelancerProfiles.listProfiles(user.orgId);
  }
}
