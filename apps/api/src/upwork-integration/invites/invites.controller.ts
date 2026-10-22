import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { ModuleAccessGuard } from "../../common/guards/module-access.guard";
import { RequiresModule } from "../../common/decorators/requires-module.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtClaims } from "@leadgen/types";
import { UpworkInvitesService } from "./invites.service";

/** Invite tracking domain — not yet built, see UpworkInvitesService's own
 *  docblock for the real lead on where to start. Same guard stack and
 *  `upwork-api` route prefix as every other Upwork sub-controller. */
@Controller("upwork-api")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule("UPWORK_API")
export class UpworkInvitesController {
  constructor(private readonly invites: UpworkInvitesService) {}

  @Get("invites")
  listInvites(@CurrentUser() user: JwtClaims) {
    return this.invites.listInvites(user.orgId);
  }
}
