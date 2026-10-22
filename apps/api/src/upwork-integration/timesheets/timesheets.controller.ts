import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { ModuleAccessGuard } from "../../common/guards/module-access.guard";
import { RequiresModule } from "../../common/decorators/requires-module.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtClaims } from "@leadgen/types";
import { UpworkTimesheetsService } from "./timesheets.service";

/** Timesheets domain (spec Module E) — currently BLOCKED by a team-level
 *  Upwork permission, see UpworkTimesheetsService's own docblock. Same
 *  guard stack and `upwork-api` route prefix as every other Upwork
 *  sub-controller. */
@Controller("upwork-api")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule("UPWORK_API")
export class UpworkTimesheetsController {
  constructor(private readonly timesheets: UpworkTimesheetsService) {}

  @Get("timesheets")
  listTimesheets(@CurrentUser() user: JwtClaims) {
    return this.timesheets.listTimesheets(user.orgId);
  }
}
