import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { ModuleAccessGuard } from "../../common/guards/module-access.guard";
import { RequiresModule } from "../../common/decorators/requires-module.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtClaims } from "@leadgen/types";
import { UpworkRoomsService } from "./rooms.service";

/** Rooms & Messages domain (spec Module K) — LIVE, READ ONLY. Same guard
 *  stack and `upwork-api` route prefix as every other Upwork
 *  sub-controller. Deliberately exposes no write/send route. */
@Controller("upwork-api")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule("UPWORK_API")
export class UpworkRoomsController {
  constructor(private readonly rooms: UpworkRoomsService) {}

  @Get("rooms")
  listRooms(@CurrentUser() user: JwtClaims) {
    return this.rooms.listRooms(user.orgId);
  }
}
