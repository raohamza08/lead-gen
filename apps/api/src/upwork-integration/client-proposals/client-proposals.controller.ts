import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { ModuleAccessGuard } from "../../common/guards/module-access.guard";
import { RequiresModule } from "../../common/decorators/requires-module.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtClaims } from "@leadgen/types";
import { UpworkClientProposalsService } from "./client-proposals.service";

/** Client Proposals domain (spec Module P) — NOT APPLICABLE to this
 *  account's role, see UpworkClientProposalsService's own docblock. Same
 *  guard stack and `upwork-api` route prefix as every other Upwork
 *  sub-controller. */
@Controller("upwork-api")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule("UPWORK_API")
export class UpworkClientProposalsController {
  constructor(private readonly clientProposals: UpworkClientProposalsService) {}

  @Get("client-proposals")
  list(@CurrentUser() user: JwtClaims) {
    return this.clientProposals.list(user.orgId);
  }
}
