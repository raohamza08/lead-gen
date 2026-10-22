import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { ModuleAccessGuard } from "../../common/guards/module-access.guard";
import { RequiresModule } from "../../common/decorators/requires-module.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtClaims } from "@leadgen/types";
import { UpworkPublicUserService } from "./public-user.service";

/** Public User Details domain (spec Module O) — LIVE. Same guard stack
 *  and `upwork-api` route prefix as every other Upwork sub-controller. */
@Controller("upwork-api")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule("UPWORK_API")
export class UpworkPublicUserController {
  constructor(private readonly publicUser: UpworkPublicUserService) {}

  @Get("public-user")
  getUserDetails(@CurrentUser() user: JwtClaims, @Query("userId") userId: string) {
    return this.publicUser.getUserDetails(user.orgId, userId);
  }
}
