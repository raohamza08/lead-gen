import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { ModuleAccessGuard } from "../../common/guards/module-access.guard";
import { RequiresModule } from "../../common/decorators/requires-module.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtClaims } from "@leadgen/types";
import { UpworkReportingService } from "./reporting.service";

/** Reporting domain — not yet built. Same guard stack and `upwork-api`
 *  route prefix as every other Upwork sub-controller. */
@Controller("upwork-api")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule("UPWORK_API")
export class UpworkReportingController {
  constructor(private readonly reporting: UpworkReportingService) {}

  @Get("reports/weekly")
  getWeeklyReport(@CurrentUser() user: JwtClaims) {
    return this.reporting.getReport(user.orgId, "weekly");
  }

  @Get("reports/monthly")
  getMonthlyReport(@CurrentUser() user: JwtClaims) {
    return this.reporting.getReport(user.orgId, "monthly");
  }

  @Get("reports/yearly")
  getYearlyReport(@CurrentUser() user: JwtClaims) {
    return this.reporting.getReport(user.orgId, "yearly");
  }
}
