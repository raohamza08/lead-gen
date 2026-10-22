import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { ModuleAccessGuard } from "../../common/guards/module-access.guard";
import { RequiresModule } from "../../common/decorators/requires-module.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtClaims } from "@leadgen/types";
import { UpworkMarketplaceJobsService } from "./marketplace-jobs.service";

/** Marketplace Job Postings + Job Details domain (spec Modules G + S) —
 *  LIVE. Same guard stack and `upwork-api` route prefix as every other
 *  Upwork sub-controller. */
@Controller("upwork-api")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule("UPWORK_API")
export class UpworkMarketplaceJobsController {
  constructor(private readonly marketplaceJobs: UpworkMarketplaceJobsService) {}

  @Get("marketplace-jobs")
  search(@CurrentUser() user: JwtClaims, @Query("q") q?: string) {
    return this.marketplaceJobs.search(user.orgId, q ?? null);
  }
}
