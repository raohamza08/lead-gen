import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { ModuleAccessGuard } from "../../common/guards/module-access.guard";
import { RequiresModule } from "../../common/decorators/requires-module.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtClaims } from "@leadgen/types";
import { UpworkBiddingService } from "./proposals.service";

/** Bidding/proposals domain — LIVE (Part: Upwork API integration,
 *  2026-10-22). Same guard stack and `upwork-api` route prefix as every
 *  other Upwork sub-controller. */
@Controller("upwork-api")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule("UPWORK_API")
export class UpworkProposalsController {
  constructor(private readonly bidding: UpworkBiddingService) {}

  @Get("proposals")
  listProposals(@CurrentUser() user: JwtClaims) {
    return this.bidding.listProposals(user.orgId);
  }
}
