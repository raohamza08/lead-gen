import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
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
@RequiresModule("UPWORK_AGENCY_JOBS")
export class UpworkMarketplaceJobsController {
  constructor(private readonly marketplaceJobs: UpworkMarketplaceJobsService) {}

  @Get("marketplace-jobs")
  search(@CurrentUser() user: JwtClaims, @Query("q") q?: string, @Query("after") after?: string, @Query("first") first?: string) {
    const parsedFirst = first ? Math.min(Math.max(Number(first) || 50, 1), 50) : 50;
    return this.marketplaceJobs.search(user.orgId, q ?? null, after ?? null, parsedFirst);
  }

  /** Fetched lazily by the detail panel, not the list — see
   *  UpworkMarketplaceJobsService.getClientInsights's own docblock. */
  @Get("marketplace-jobs/:id/client-insights")
  clientInsights(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.marketplaceJobs.getClientInsights(user.orgId, id);
  }
}
