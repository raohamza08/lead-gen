import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { UpworkRoomsSyncService } from "./rooms-sync.service";

/**
 * Rooms & Messages (spec Module K) — LIVE, READ ONLY (Part: Upwork API
 * integration — Rooms & Messages domain, 2026-10-23). Reads only —
 * UpworkRoomsSyncWorker/Service own talking to Upwork on a schedule. No
 * send-message action exists anywhere in this module, by design.
 */
@Injectable()
export class UpworkRoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roomsSync: UpworkRoomsSyncService,
  ) {}

  /** Displayed unread count (Part: Rooms & Messages read state,
   *  2026-10-23) — 0 once `locallyReadAt` is at or after
   *  `latestMessageAt`, otherwise the real synced `numUnread`. See
   *  UpworkApiRoom.locallyReadAt's own schema docblock for why this is
   *  a local overlay, not a mutation of Upwork's own unread flag. */
  private displayedUnread(r: { numUnread: number | null; latestMessageAt: Date | null; locallyReadAt: Date | null }): number {
    if (r.locallyReadAt && r.latestMessageAt && r.locallyReadAt.getTime() >= r.latestMessageAt.getTime()) return 0;
    return r.numUnread ?? 0;
  }

  async listRooms(orgId: string) {
    const rooms = await this.prisma.upworkApiRoom.findMany({
      where: { orgId },
      orderBy: { latestMessageAt: "desc" },
    });
    return {
      totalCount: rooms.length,
      totalUnread: rooms.reduce((sum, r) => sum + this.displayedUnread(r), 0),
      rooms: rooms.map((r) => ({
        id: r.id,
        roomName: r.roomName,
        roomType: r.roomType,
        numUsers: r.numUsers,
        numUnread: this.displayedUnread(r),
        latestMessage: r.latestMessage,
        latestMessageAt: r.latestMessageAt,
        latestMessageFrom: r.latestMessageFrom,
      })),
    };
  }

  /** Rooms unanswered for 15+ minutes, trailing 7 days (Part: Delayed
   *  Responses module, 2026-10-23, explicit user request — "the chats
   *  that are unanswered for last 15 mins or more for one week should
   *  go there"). Uses the real synced `numUnread`/`latestMessageAt`, not
   *  the local `locallyReadAt` overlay — opening a room in Outly clears
   *  its badge (see displayedUnread above) but doesn't mean the client
   *  actually got a reply, which is what this list is tracking. Same
   *  "pending" definition as UpworkRoomPendingReminderWorker's desktop
   *  reminders — see that worker's own docblock for why numUnread>0 is
   *  the honest proxy available here. */
  async listDelayedResponses(orgId: string, thresholdMinutes = 15, windowDays = 7) {
    const now = Date.now();
    const rooms = await this.prisma.upworkApiRoom.findMany({
      where: {
        orgId,
        numUnread: { gt: 0 },
        latestMessageAt: { lte: new Date(now - thresholdMinutes * 60000), gte: new Date(now - windowDays * 24 * 60 * 60000) },
      },
      orderBy: { latestMessageAt: "asc" },
    });
    return {
      totalCount: rooms.length,
      rooms: rooms.map((r) => ({
        id: r.id,
        roomName: r.roomName,
        roomType: r.roomType,
        numUnread: r.numUnread,
        latestMessage: r.latestMessage,
        latestMessageAt: r.latestMessageAt,
        latestMessageFrom: r.latestMessageFrom,
        minutesPending: r.latestMessageAt ? Math.floor((now - r.latestMessageAt.getTime()) / 60000) : null,
      })),
    };
  }

  /** Marks a room as read IN OUTLY (Part: Rooms & Messages read state,
   *  2026-10-23, explicit user request — "after opening the chat, the
   *  count badge is not going, make sure it works properly"). Local
   *  only — never calls any mark-read mutation on Upwork's own side. */
  async markRoomRead(orgId: string, roomId: string): Promise<void> {
    const result = await this.prisma.upworkApiRoom.updateMany({ where: { id: roomId, orgId }, data: { locallyReadAt: new Date() } });
    if (result.count === 0) throw new NotFoundException("Room not found");
  }

  /** Real message history for one room (Part: Rooms & Messages chat
   *  history, 2026-10-23, explicit user request — "when a chat is
   *  opened from below and it doesn't have any of its communication,
   *  the api should fetch the recent communication right away"). If
   *  nothing's cached yet for this room, fetches live from Upwork
   *  before responding rather than returning an empty list — the
   *  periodic quick-tick sync already keeps the top 30 active rooms
   *  warm, so this on-demand path only actually hits Upwork for rooms
   *  outside that set or on a brand-new connection. */
  async getRoomMessages(orgId: string, roomId: string) {
    const room = await this.prisma.upworkApiRoom.findFirst({ where: { id: roomId, orgId } });
    if (!room) throw new NotFoundException("Room not found");

    let messages = await this.prisma.upworkApiRoomMessage.findMany({
      where: { orgId, upworkRoomId: room.upworkRoomId },
      orderBy: { createdAt: "asc" },
    });

    if (messages.length === 0) {
      const connectionRow = await this.prisma.upworkApiConnection.findUnique({ where: { orgId } });
      if (connectionRow?.status === "CONNECTED") {
        await this.roomsSync.syncMessagesForRoom(connectionRow, room.upworkRoomId, room.roomName);
        messages = await this.prisma.upworkApiRoomMessage.findMany({
          where: { orgId, upworkRoomId: room.upworkRoomId },
          orderBy: { createdAt: "asc" },
        });
      }
    }

    return {
      roomId: room.id,
      roomName: room.roomName,
      messages: messages.map((m) => ({
        id: m.id,
        message: m.message,
        senderName: m.senderName,
        senderIsAgency: m.senderIsAgency,
        createdAt: m.createdAt,
      })),
    };
  }
}
