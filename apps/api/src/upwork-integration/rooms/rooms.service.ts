import { Injectable, NotFoundException } from "@nestjs/common";
import { UpworkProfileGroup } from "@prisma/client";
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

  /** Rooms where the CLIENT's latest message is still unanswered, trailing
   *  7 days (Part: Delayed Responses module, 2026-10-23, explicit user
   *  request — "the chats that are unanswered for last 15 mins or more
   *  for one week should go there"; corrected 2026-10-23 same day,
   *  explicit user feedback — "it should only disappear from this module
   *  once the freelancer has responded to the person", NOT once someone
   *  on our side merely opens/views the room in Outly; the original
   *  15-minute pending threshold was removed 2026-10-26, explicit user
   *  request — "remove the time delay and it should work in realtime", so
   *  a room appears the moment its latest sync shows an unanswered client
   *  message, not 15 minutes after). Deliberately does NOT use
   *  `numUnread` or `locallyReadAt` at all — both can be cleared just by
   *  looking at a room, which isn't a real response. The real signal is
   *  direction: a room only counts as unanswered while its own latest
   *  message is still from the CLIENT side (via UpworkRoomsSyncService.
   *  isSenderAgencySide against the room's own cached `latestMessageFrom`/
   *  `roomName` — no per-message history sync needed for this check).
   *  The moment the freelancer actually replies on Upwork, the next
   *  sync tick updates `latestMessageFrom` to the freelancer's name,
   *  this check flips, and the room drops off this list on its own —
   *  nothing in Outly needs to "mark" anything for that to happen.
   *  "Realtime" here is still bounded by how often UpworkRoomsSyncService
   *  pulls fresh data from Upwork (its quick tick runs every 15 minutes,
   *  see that service's own docblock) — this threshold only controls how
   *  long a room sits in Outly's own cache before showing up here, not
   *  how fast Outly learns about a new unanswered message in the first
   *  place. */
  async listDelayedResponses(orgId: string, thresholdMinutes = 0, windowDays = 7) {
    const now = Date.now();
    const rooms = await this.prisma.upworkApiRoom.findMany({
      where: {
        orgId,
        latestMessageAt: { lte: new Date(now - thresholdMinutes * 60000), gte: new Date(now - windowDays * 24 * 60 * 60000) },
      },
      orderBy: { latestMessageAt: "asc" },
    });
    const pending = rooms.filter((r) => {
      if (this.roomsSync.isSenderAgencySide(r.latestMessageFrom, r.roomName)) return false;
      // Manually dismissed ("mark as responded") and nothing newer from
      // the client has come in since — stays hidden until it does.
      if (r.delayedResponseDismissedAt && r.latestMessageAt && r.delayedResponseDismissedAt.getTime() >= r.latestMessageAt.getTime()) {
        return false;
      }
      return true;
    });

    const groupByFirstName = await this.buildProfileGroupIndex(orgId);
    const roomsWithGroups = pending.map((r) => ({
      room: r,
      groups: this.resolveRoomGroups(r.assignedProfileNames, groupByFirstName),
    }));

    const counts = { GRAPHICS: 0, TECH: 0, UNASSIGNED: 0 };
    for (const { groups } of roomsWithGroups) {
      if (groups.length === 0) counts.UNASSIGNED += 1;
      else {
        if (groups.includes("GRAPHICS")) counts.GRAPHICS += 1;
        if (groups.includes("TECH")) counts.TECH += 1;
      }
    }

    return {
      totalCount: pending.length,
      counts,
      rooms: roomsWithGroups.map(({ room: r, groups }) => ({
        id: r.id,
        roomName: r.roomName,
        roomType: r.roomType,
        numUsers: r.numUsers,
        numUnread: r.numUnread,
        latestMessage: r.latestMessage,
        latestMessageAt: r.latestMessageAt,
        latestMessageFrom: r.latestMessageFrom,
        minutesPending: r.latestMessageAt ? Math.floor((now - r.latestMessageAt.getTime()) / 60000) : null,
        groups,
      })),
    };
  }

  /** Lowercased-first-name → group lookup, built fresh per call from
   *  active, grouped UpworkFreelancerProfile rows (Part: Delayed
   *  Responses team inboxes, 2026-10-26). Deliberately only matches
   *  against profiles that HAVE a group set — a profile with no group,
   *  or a name with no matching profile at all (most notably EurosHub's
   *  own agency admin, who has no UpworkFreelancerProfile row), simply
   *  doesn't match anything and the room falls through to "Unassigned"
   *  instead of being guessed at. */
  private async buildProfileGroupIndex(orgId: string): Promise<Map<string, UpworkProfileGroup>> {
    const profiles = await this.prisma.upworkFreelancerProfile.findMany({
      where: { orgId, active: true, group: { not: null } },
      select: { name: true, group: true },
    });
    const index = new Map<string, UpworkProfileGroup>();
    for (const p of profiles) {
      if (p.group) index.set(p.name.trim().toLowerCase(), p.group);
    }
    return index;
  }

  /** A room can show in BOTH inboxes if it has at least one assigned
   *  profile from each group (explicit user decision, 2026-10-26 — "show
   *  in both inboxes... so neither team misses it") — rare in practice
   *  (most rooms' `assignedProfileNames` resolve to one group or none)
   *  but not blocked. Matches on first name only, same convention as
   *  UpworkRoomsSyncService.isSenderAgencySide — Upwork's own display
   *  names here are consistently "{First} {LastInitial}.". */
  private resolveRoomGroups(assignedProfileNames: string[], groupByFirstName: Map<string, UpworkProfileGroup>): UpworkProfileGroup[] {
    const matched = new Set<UpworkProfileGroup>();
    for (const fullName of assignedProfileNames) {
      const firstName = fullName.trim().split(/\s+/)[0]?.toLowerCase();
      if (!firstName) continue;
      const group = groupByFirstName.get(firstName);
      if (group) matched.add(group);
    }
    return [...matched];
  }

  /** Marks a room as read IN OUTLY (Part: Rooms & Messages read state,
   *  2026-10-23, explicit user request — "after opening the chat, the
   *  count badge is not going, make sure it works properly"). Local
   *  only — never calls any mark-read mutation on Upwork's own side. */
  async markRoomRead(orgId: string, roomId: string): Promise<void> {
    const result = await this.prisma.upworkApiRoom.updateMany({ where: { id: roomId, orgId }, data: { locallyReadAt: new Date() } });
    if (result.count === 0) throw new NotFoundException("Room not found");
  }

  /** "Mark as responded" (Part: Delayed Responses manual dismiss,
   *  2026-10-26) — removes a room from listDelayedResponses immediately,
   *  without waiting for the next sync tick to see a real reply on
   *  Upwork. See UpworkApiRoom.delayedResponseDismissedAt's own docblock
   *  for why this self-reverts instead of being a permanent mute. */
  async markDelayedResponseHandled(orgId: string, roomId: string): Promise<void> {
    const result = await this.prisma.upworkApiRoom.updateMany({
      where: { id: roomId, orgId },
      data: { delayedResponseDismissedAt: new Date() },
    });
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
