import { Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims } from "@leadgen/types";
import { NotificationsService } from "./notifications.service";

@Controller("notifications")
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: JwtClaims, @Query("limit") limit?: string) {
    return this.notifications.list(user.orgId, Number(limit) || 50);
  }

  @Patch("read-all")
  markAllRead(@CurrentUser() user: JwtClaims) {
    return this.notifications.markAllRead(user.orgId);
  }

  @Patch(":id/read")
  markRead(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.notifications.markRead(user.orgId, id);
  }
}
