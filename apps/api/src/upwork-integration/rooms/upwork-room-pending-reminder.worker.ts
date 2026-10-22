import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { NotificationCategory, Role } from "@prisma/client";
import { getRedisConnection, QUEUE_NAMES } from "../../common/queue/redis-connection";
import { PrismaService } from "../../common/prisma/prisma.service";
import { NotificationsService } from "../../notifications/notifications.service";

/**
 * Desktop "pending chat response" reminders (Part: Rooms & Messages
 * desktop notifications, 2026-10-23, explicit user request). Delivered
 * through the app's EXISTING desktop-notification pipeline
 * (NotificationsService.notify → realtime `notification.created` event
 * → notifications-bell.tsx's own `new window.Notification(...)` call
 * when the user has both general desktop notifications AND this
 * specific reminder enabled) rather than a parallel one — the user's
 * own spec permits reusing "the application's existing desktop
 * notification integration", and this app already has a real one
 * (confirmed: fires an actual OS Notification, not a toast/bell-badge,
 * gated on browser permission + `document.hidden`).
 *
 * "Pending" is derived from two real synced fields on UpworkApiRoom —
 * `numUnread > 0` (Upwork's own unread flag) and `latestMessageAt` (the
 * real message timestamp) — there is no per-message direction/read
 * trace available from what's synced (only the single latest message
 * per room is stored), so this is necessarily a room-level
 * approximation, not a true per-message "needs a reply" classifier:
 * numUnread > 0 means nobody on this org's Upwork account has read or
 * replied to the latest activity yet, which in practice means the
 * latest message came from the other side and sits unanswered — see
 * UpworkRoomsSyncService's own docblock for how numUnread/
 * latestMessageAt get refreshed (now every 15 minutes via the quick
 * tier). Resolves automatically: once someone replies or marks it read
 * in Upwork, the next sync clears numUnread, which drops the room out
 * of the "due" query on its own — no separate resolve step needed.
 *
 * "Profile name" in the notification body (Part: client-profile-name
 * update, 2026-10-23) is `UpworkApiRoom.roomName` — there's no separate
 * client/profile entity distinct from the room in this data model;
 * Upwork's own `roomList` already formats `roomName` as the other
 * party's identity (e.g. "Maria ONeil, Daffodiljill"), which is exactly
 * what a "profile name" would show here. Falls back to a generic label
 * only when `roomName` is genuinely null.
 */
@Injectable()
export class UpworkRoomPendingReminderWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UpworkRoomPendingReminderWorker.name);
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(QUEUE_NAMES.UPWORK_ROOM_PENDING_REMINDER, () => this.tick(), {
      connection: getRedisConnection(),
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`upwork-room-pending-reminder tick failed: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  async tick() {
    const now = new Date();

    const enabledUsers = await this.prisma.user.findMany({
      where: {
        active: true,
        upworkChatReminderEnabled: true,
        OR: [{ role: Role.ADMIN }, { upworkAgencyRoomsAccess: true }],
      },
      select: { id: true, orgId: true, upworkChatReminderThresholdMinutes: true },
    });
    if (enabledUsers.length === 0) return;

    const usersByOrg = new Map<string, typeof enabledUsers>();
    for (const u of enabledUsers) {
      const list = usersByOrg.get(u.orgId) ?? [];
      list.push(u);
      usersByOrg.set(u.orgId, list);
    }

    for (const [orgId, users] of usersByOrg) {
      try {
        await this.tickOrg(orgId, users, now);
      } catch (err) {
        this.logger.warn(`Pending-chat reminder sweep failed for org ${orgId}: ${(err as Error).message}`);
      }
    }
  }

  private async tickOrg(
    orgId: string,
    users: { id: string; upworkChatReminderThresholdMinutes: number }[],
    now: Date,
  ): Promise<void> {
    const minThresholdMs = Math.min(...users.map((u) => u.upworkChatReminderThresholdMinutes)) * 60 * 1000;
    const candidateRooms = await this.prisma.upworkApiRoom.findMany({
      where: { orgId, numUnread: { gt: 0 }, latestMessageAt: { not: null, lte: new Date(now.getTime() - minThresholdMs) } },
      select: { id: true, upworkRoomId: true, roomName: true, latestMessageAt: true },
    });
    if (candidateRooms.length === 0) return;

    const existingStates = await this.prisma.upworkRoomReminderState.findMany({
      where: { orgId, upworkRoomId: { in: candidateRooms.map((r) => r.upworkRoomId) } },
      select: { userId: true, upworkRoomId: true, lastNotifiedMessageAt: true },
    });
    const stateKey = (userId: string, roomId: string) => `${userId}:${roomId}`;
    const stateByKey = new Map(existingStates.map((s) => [stateKey(s.userId, s.upworkRoomId), s]));

    for (const room of candidateRooms) {
      const latestMessageAt = room.latestMessageAt!;
      const ageMs = now.getTime() - latestMessageAt.getTime();
      const dueUsers = users.filter((u) => {
        if (ageMs < u.upworkChatReminderThresholdMinutes * 60 * 1000) return false;
        const state = stateByKey.get(stateKey(u.id, room.upworkRoomId));
        return !state || state.lastNotifiedMessageAt.getTime() < latestMessageAt.getTime();
      });
      if (dueUsers.length === 0) continue;

      const minutesPending = Math.floor(ageMs / 60000);
      const roomLabel = room.roomName ?? "a room";
      try {
        await this.notifications.notify(orgId, {
          category: NotificationCategory.UPWORK,
          type: "UPWORK_ROOM_PENDING_RESPONSE",
          title: "Pending Chat Response",
          message: `The chat with ${roomLabel} has been awaiting a response for ${minutesPending} minutes. Please review the conversation.`,
          // `room.id` (our internal row id) — matches what UpworkRoomsService.listRooms
          // exposes to the frontend as each room's `id`, which the Rooms page's
          // selection state compares against. NOT upworkRoomId (Upwork's own
          // external id) — those are different values for the same room.
          actionUrl: `/upwork-agency/rooms?room=${encodeURIComponent(room.id)}`,
          severity: "WARNING",
          entityType: "upworkApiRoom",
          entityId: room.id,
          recipientUserIds: dueUsers.map((u) => u.id),
        });
        await this.prisma.$transaction(
          dueUsers.map((u) =>
            this.prisma.upworkRoomReminderState.upsert({
              where: { orgId_userId_upworkRoomId: { orgId, userId: u.id, upworkRoomId: room.upworkRoomId } },
              create: { orgId, userId: u.id, upworkRoomId: room.upworkRoomId, lastNotifiedMessageAt: latestMessageAt, notifiedAt: now },
              update: { lastNotifiedMessageAt: latestMessageAt, notifiedAt: now },
            }),
          ),
        );
      } catch (err) {
        this.logger.warn(`Pending-chat reminder failed for room ${room.upworkRoomId} (org ${orgId}): ${(err as Error).message}`);
      }
    }
  }
}
