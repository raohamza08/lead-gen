import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";

/**
 * Rooms & Messages (spec Module K) — LIVE, READ ONLY (Part: Upwork API
 * integration — Rooms & Messages domain, 2026-10-23). Reads only —
 * UpworkRoomsSyncWorker/Service own talking to Upwork on a schedule. No
 * send-message action exists anywhere in this module, by design.
 */
@Injectable()
export class UpworkRoomsService {
  constructor(private readonly prisma: PrismaService) {}

  async listRooms(orgId: string) {
    const rooms = await this.prisma.upworkApiRoom.findMany({
      where: { orgId },
      orderBy: { latestMessageAt: "desc" },
    });
    return {
      totalCount: rooms.length,
      totalUnread: rooms.reduce((sum, r) => sum + (r.numUnread ?? 0), 0),
      rooms: rooms.map((r) => ({
        id: r.id,
        roomName: r.roomName,
        roomType: r.roomType,
        numUsers: r.numUsers,
        numUnread: r.numUnread,
        latestMessage: r.latestMessage,
        latestMessageAt: r.latestMessageAt,
        latestMessageFrom: r.latestMessageFrom,
      })),
    };
  }
}
