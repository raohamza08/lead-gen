import { Controller, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { ModuleAccessGuard } from "../../common/guards/module-access.guard";
import { RequiresModule } from "../../common/decorators/requires-module.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtClaims } from "@leadgen/types";
import { UpworkChatMonitoringService } from "./chat-monitoring.service";

/** Client communication monitoring domain — not yet built, deliberately
 *  last (see UpworkChatMonitoringService's own docblock: the single most
 *  sensitive scope, reads message content). Same guard stack and
 *  `upwork-api` route prefix as every other Upwork sub-controller. */
@Controller("upwork-api")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule("UPWORK_API")
export class UpworkChatMonitoringController {
  constructor(private readonly chatMonitoring: UpworkChatMonitoringService) {}

  @Post("chat-monitoring/scan")
  scanChats(@CurrentUser() user: JwtClaims) {
    return this.chatMonitoring.scanActiveContractsForConcerns(user.orgId);
  }
}
