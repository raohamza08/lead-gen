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
 *  multiple controllers safely share one prefix.
 *
 *  Gated on UPWORK_AGENCY_TRANSACTIONS, not the retired UPWORK_API (Part:
 *  permission-category audit, 2026-10-23, explicit user request — "ensure
 *  each module is listed in the proper permission category"). Its one real
 *  caller is the Transactions page's Connects Usage widget, which is
 *  itself gated by upworkAgencyTransactionsAccess — that flag has a real
 *  checkbox in person-access-panel.tsx; upworkApiAccess does not (removed
 *  when the granular upworkAgency* flags replaced it). Any user granted
 *  Transactions access after that change had no way to also get
 *  upworkApiAccess, so the page loaded but this endpoint 403'd — same
 *  flag as the page that actually calls it fixes that for good, not just
 *  for users who happened to have the old flag already set. */
@Controller("upwork-api")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule("UPWORK_AGENCY_TRANSACTIONS")
export class UpworkConnectsUsageController {
  constructor(private readonly connectsUsage: UpworkConnectsUsageService) {}

  @Get("connects-usage")
  getConnectsUsage(@CurrentUser() user: JwtClaims) {
    return this.connectsUsage.getConnectsUsage(user.orgId);
  }
}
