import { Controller, Get, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { ModuleAccessGuard } from "../../common/guards/module-access.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequiresModule } from "../../common/decorators/requires-module.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtClaims, Role } from "@leadgen/types";
import { UpworkRoomsService } from "./rooms.service";
import { UpworkRoomsSyncService } from "./rooms-sync.service";

/** Rooms & Messages domain (spec Module K) — LIVE, READ ONLY. Same guard
 *  stack and `upwork-api` route prefix as every other Upwork
 *  sub-controller. Deliberately exposes no write/send route — `resync`
 *  below only forces an immediate pull of this same read-only data, it
 *  never sends anything to Upwork. */
@Controller("upwork-api")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule("UPWORK_AGENCY_ROOMS")
export class UpworkRoomsController {
  constructor(
    private readonly rooms: UpworkRoomsService,
    private readonly roomsSync: UpworkRoomsSyncService,
  ) {}

  @Get("rooms")
  listRooms(@CurrentUser() user: JwtClaims) {
    return this.rooms.listRooms(user.orgId);
  }

  @Post("rooms/resync")
  @Roles(Role.ADMIN)
  async resync(@CurrentUser() user: JwtClaims) {
    await this.roomsSync.syncOrgNow(user.orgId);
    return { resynced: true };
  }
}
