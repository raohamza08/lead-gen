import { Body, Controller, Delete, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { NotificationCategory } from "@prisma/client";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims } from "@leadgen/types";
import { NotificationsService } from "./notifications.service";
import { UpdateNotificationPreferencesDto } from "./dto/update-notification-preferences.dto";

function parseCategory(value?: string): NotificationCategory | undefined {
  if (!value) return undefined;
  return Object.values(NotificationCategory).includes(value as NotificationCategory)
    ? (value as NotificationCategory)
    : undefined;
}

@Controller("notifications")
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: JwtClaims,
    @Query("category") category?: string,
    @Query("unreadOnly") unreadOnly?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.notifications.list(user, {
      category: parseCategory(category),
      unreadOnly: unreadOnly === "true",
      page: Number(page) || undefined,
      pageSize: Number(pageSize) || undefined,
    });
  }

  @Get("unread-count")
  unreadCount(@CurrentUser() user: JwtClaims) {
    return this.notifications.unreadCount(user);
  }

  @Patch("read-all")
  markAllRead(@CurrentUser() user: JwtClaims, @Query("category") category?: string) {
    return this.notifications.markAllRead(user, parseCategory(category));
  }

  @Patch(":id/read")
  markRead(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.notifications.markRead(user, id);
  }

  @Delete(":id")
  dismiss(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.notifications.dismiss(user, id);
  }

  @Delete()
  dismissAll(@CurrentUser() user: JwtClaims, @Query("category") category?: string) {
    return this.notifications.dismissAll(user, parseCategory(category));
  }

  @Get("preferences")
  getPreferences(@CurrentUser() user: JwtClaims) {
    return this.notifications.getPreferences(user.sub);
  }

  @Patch("preferences")
  updatePreferences(@CurrentUser() user: JwtClaims, @Body() dto: UpdateNotificationPreferencesDto) {
    return this.notifications.updatePreferences(user.sub, dto);
  }
}
