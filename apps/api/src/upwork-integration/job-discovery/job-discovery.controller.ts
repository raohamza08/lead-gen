import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { ModuleAccessGuard } from "../../common/guards/module-access.guard";
import { RequiresModule } from "../../common/decorators/requires-module.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtClaims } from "@leadgen/types";
import { UpworkJobDiscoveryService } from "./job-discovery.service";

/** Job discovery domain — not yet built. Same guard stack and `upwork-api`
 *  route prefix as every other Upwork sub-controller. */
@Controller("upwork-api")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule("UPWORK_API")
export class UpworkJobDiscoveryController {
  constructor(private readonly jobDiscovery: UpworkJobDiscoveryService) {}

  @Get("jobs/relevant")
  listRelevantJobs(@CurrentUser() user: JwtClaims) {
    return this.jobDiscovery.listRelevantJobs(user.orgId);
  }
}
