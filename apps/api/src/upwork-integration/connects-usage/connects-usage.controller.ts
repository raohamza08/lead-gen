import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { ModuleAccessGuard } from "../../common/guards/module-access.guard";
import { RequiresModule } from "../../common/decorators/requires-module.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtClaims } from "@leadgen/types";
import { UpworkConnectsUsageService } from "./connects-usage.service";

/** Connects usage domain — LIVE (Part: Upwork API integration, 2026-10-22).
 *  Same guard stack and `upwork-api` route prefix as every other Upwork
 *  sub-controller — see UpworkConnectionController's own docblock for why
 *  multiple controllers safely share one prefix. */
@Controller("upwork-api")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule("UPWORK_API")
export class UpworkConnectsUsageController {
  constructor(private readonly connectsUsage: UpworkConnectsUsageService) {}

  @Get("connects-usage")
  getConnectsUsage(@CurrentUser() user: JwtClaims) {
    return this.connectsUsage.getConnectsUsage(user.orgId);
  }
}
