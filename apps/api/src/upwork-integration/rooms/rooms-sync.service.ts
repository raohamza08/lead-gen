import { Injectable, Logger } from "@nestjs/common";
import { UpworkApiConnection } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { UpworkGraphQLClient } from "../shared/upwork-graphql.client";
import { UpworkApiConnectionService } from "../connection/upwork-api-connection.service";

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Hard ceiling on pages fetched per FULL sync tick, same safety
 *  reasoning as every other Upwork sync service's own cap. 200 pages *
 *  50/page = 10,000 rooms per tick. */
const MAX_PAGES = 200;
const PAGE_SIZE = 50;

/** How many pages the QUICK tick walks (Part: Upwork API integration —
 *  Rooms & Messages two-tier sync, 2026-10-23, explicit user request —
 *  "set the chat sync time to 15 mins" balanced against a real budget
 *  finding: after the org switch, this agency has 4,084 real rooms, so
 *  a FULL walk is ~82 GraphQL calls — doing that every 15 minutes would
 *  cost ~7,900 calls/day against the user's stated ~500/day budget.
 *  `roomList`'s default order is confirmed live to be most-recent-
 *  activity-first (walked 1,000+ rooms deep and watched timestamps drop
 *  from "today" to three months old), so a shallow 2-page/100-room walk
 *  every 15 min keeps genuinely active conversations fresh for ~4
 *  calls/tick (~384/day) without paying for the whole catalog each time. */
const QUICK_SYNC_PAGES = 2;

/** Real message history for the top N most recently active rooms (Part:
 *  Rooms & Messages chat history, 2026-10-23, explicit user request —
 *  "the 30 chats that are on top, their chat history for at least 1 day
 *  is available"). Only rooms whose `latestMessageAt` has moved past
 *  what's already cached get fetched each tick, not all 30
 *  unconditionally — keeps the real added cost proportional to actual
 *  new activity instead of a flat 30 calls every 15 minutes. */
const TOP_ROOMS_FOR_MESSAGE_SYNC = 30;
const ROOM_MESSAGE_PAGE_SIZE = 50;

/**
 * Rooms & Messages sync logic (spec Module K, Part: Upwork API
 * integration — Rooms & Messages domain, 2026-10-23) — same split as
 * every other Upwork sync service. `roomList` requires no filter and
 * returns rooms org-wide, cursor-paginated, most-recent-activity-first
 * by default (confirmed live, see QUICK_SYNC_PAGES docblock above).
 * Stops on an empty page, not on `hasNextPage` (same reasoning as
 * UpworkInvitesSyncService — don't assume this field is reliable
 * without re-confirming; stopping on an empty page is the one pattern
 * confirmed safe across every Upwork query tested this session). READ
 * ONLY, see UpworkGraphQLClient.getRoomListPage's own docblock — this
 * never calls any of Upwork's real send-message mutations.
 *
 * Two-tier sync (Part: two-tier sync, 2026-10-23): a cheap QUICK tick
 * every 15 minutes upserts only the first QUICK_SYNC_PAGES pages (the
 * most recently active rooms) with no deletion, so a room that just
 * isn't among the most-active ones right now is never mistaken for
 * archived. A FULL tick every 6 hours (matching every other Upwork
 * domain's own cadence) walks the entire catalog and does the
 * full-replace: drops anything stored for this org that pass didn't
 * see, so a tenant switch (the real incident this was built for — see
 * below) or a genuinely archived room can't linger forever. The full
 * walk only needs to run a few times a day since it exists for
 * completeness/cleanup, not freshness — the quick tick already owns
 * freshness for anything anyone would actually be checking on.
 *
 * Full-replace background: this connection was bound to the wrong
 * Upwork tenant (the user's personal account, not the EurosHub agency)
 * for a while, so ~242 personal-account rooms were already stored under
 * this orgId. Pointing the connection at the real agency tenant returns
 * a completely different room-ID set (confirmed live) — a plain upsert
 * would leave both accounts' rooms mixed together permanently instead
 * of showing only what's really in the now-correct account.
 */
@Injectable()
export class UpworkRoomsSyncService {
  private readonly logger = new Logger(UpworkRoomsSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connection: UpworkApiConnectionService,
    private readonly graphql: UpworkGraphQLClient,
  ) {}

  /** Manual "sync now" entry point — still used by the backend route
   *  even though the frontend's own "Sync now" button was removed
   *  (Part: Upwork API integration, 2026-10-23, explicit user request)
   *  now that the quick tick makes it largely redundant for everyday
   *  use. Runs a FULL sync, not quick — a deliberate manual trigger
   *  should give the complete, reconciled picture. */
  async syncOrgNow(orgId: string): Promise<void> {
    const connectionRow = await this.prisma.upworkApiConnection.findUnique({ where: { orgId } });
    if (!connectionRow || connectionRow.status !== "CONNECTED") {
      throw new Error("Upwork API is not connected for this organization");
    }
    await this.syncConnectionFull(connectionRow);
  }

  /** Walks up to `maxPages` pages starting from the most recent room,
   *  upserting each one. Returns each room seen (id/name/latestMessageAt),
   *  so a full pass can use the id list for the full-replace delete and
   *  the quick pass can use the richer data to decide which rooms need a
   *  message-history sync too — a partial (quick) pass must NOT use the
   *  id list for deletion, since "not seen in the first 2 pages" says
   *  nothing about whether a room still exists. */
  private async upsertPages(
    connectionRow: UpworkApiConnection,
    maxPages: number,
  ): Promise<{ upworkRoomId: string; roomName: string | null; latestMessageAt: Date | null }[]> {
    const seen: { upworkRoomId: string; roomName: string | null; latestMessageAt: Date | null }[] = [];
    await this.connection.withFreshTokenOnAuthFailure(connectionRow.orgId, async ({ accessToken, organizationId }) => {
      let after: string | null = null;
      let pages = 0;
      do {
        const page = await this.graphql.getRoomListPage(accessToken, organizationId, after, PAGE_SIZE);
        if (!page.edges.length) break;
        await this.prisma.$transaction(
          page.edges.map((e) => {
            const data = {
              roomName: e.node.roomName,
              roomType: e.node.roomType,
              numUsers: e.node.numUsers,
              numUnread: e.node.numUnread,
              upworkCreatedAt: toDate(e.node.createdAtDateTime),
              latestMessage: e.node.latestStory?.message?.slice(0, 2000) ?? null,
              latestMessageAt: toDate(e.node.latestStory?.createdDateTime),
              latestMessageFrom: e.node.latestStory?.user?.name ?? null,
              assignedProfileNames: this.extractAssignedProfileNames(e.node.roomUsers),
              ownerName: e.node.roomUsers?.find((ru) => ru.role === "owner")?.user?.name ?? null,
              ownerUpworkUserId: e.node.roomUsers?.find((ru) => ru.role === "owner")?.user?.id ?? null,
            };
            return this.prisma.upworkApiRoom.upsert({
              where: { orgId_upworkRoomId: { orgId: connectionRow.orgId, upworkRoomId: e.node.id } },
              create: { orgId: connectionRow.orgId, upworkRoomId: e.node.id, ...data },
              update: data,
            });
          }),
        );
        seen.push(
          ...page.edges.map((e) => ({
            upworkRoomId: e.node.id,
            roomName: e.node.roomName,
            latestMessageAt: toDate(e.node.latestStory?.createdDateTime),
          })),
        );
        pages += 1;
        after = page.pageInfo?.endCursor ?? null;
      } while (after && pages < maxPages);
    });
    return seen;
  }

  /** FULL sync — every room, full-replace delete. Run every 6 hours by
   *  the worker's "full-tick" job. */
  async syncConnectionFull(connectionRow: UpworkApiConnection): Promise<void> {
    try {
      const seen = await this.upsertPages(connectionRow, MAX_PAGES);
      await this.prisma.upworkApiRoom.deleteMany({
        where: { orgId: connectionRow.orgId, upworkRoomId: { notIn: seen.map((s) => s.upworkRoomId) } },
      });
      await this.prisma.upworkApiConnection.update({
        where: { id: connectionRow.id },
        data: { lastSyncAt: new Date(), lastSyncError: null },
      });
    } catch (err) {
      const message = (err as Error).message.slice(0, 300);
      this.logger.warn(`Rooms full sync failed for org ${connectionRow.orgId}: ${message}`);
      await this.prisma.upworkApiConnection.update({
        where: { id: connectionRow.id },
        data: { lastSyncError: message },
      });
      throw err;
    }
  }

  /** QUICK sync — most-recently-active rooms, no deletion, then real
   *  message history for the top TOP_ROOMS_FOR_MESSAGE_SYNC of those
   *  that actually have new activity since what's cached. Run every 15
   *  minutes by the worker's "quick-tick" job. */
  async syncConnectionQuick(connectionRow: UpworkApiConnection): Promise<void> {
    try {
      const seen = await this.upsertPages(connectionRow, QUICK_SYNC_PAGES);
      const topRooms = [...seen]
        .filter((r) => r.latestMessageAt)
        .sort((a, b) => b.latestMessageAt!.getTime() - a.latestMessageAt!.getTime())
        .slice(0, TOP_ROOMS_FOR_MESSAGE_SYNC);

      if (topRooms.length > 0) {
        const cachedNewest = await this.prisma.upworkApiRoomMessage.groupBy({
          by: ["upworkRoomId"],
          where: { orgId: connectionRow.orgId, upworkRoomId: { in: topRooms.map((r) => r.upworkRoomId) } },
          _max: { createdAt: true },
        });
        const cachedNewestByRoom = new Map(cachedNewest.map((c) => [c.upworkRoomId, c._max.createdAt]));

        for (const room of topRooms) {
          const cachedAt = cachedNewestByRoom.get(room.upworkRoomId) ?? null;
          if (cachedAt && room.latestMessageAt && cachedAt.getTime() >= room.latestMessageAt.getTime()) continue;
          try {
            await this.syncMessagesForRoom(connectionRow, room.upworkRoomId, room.roomName);
          } catch (err) {
            this.logger.warn(`Message sync failed for room ${room.upworkRoomId} (org ${connectionRow.orgId}): ${(err as Error).message}`);
          }
        }
      }

      await this.prisma.upworkApiConnection.update({
        where: { id: connectionRow.id },
        data: { lastSyncAt: new Date(), lastSyncError: null },
      });
    } catch (err) {
      const message = (err as Error).message.slice(0, 300);
      this.logger.warn(`Rooms quick sync failed for org ${connectionRow.orgId}: ${message}`);
      await this.prisma.upworkApiConnection.update({
        where: { id: connectionRow.id },
        data: { lastSyncError: message },
      });
      throw err;
    }
  }

  /** Best-effort "is this message from our side (the agency/freelancer)
   *  or the client's side" (Part: Rooms & Messages chat history,
   *  2026-10-23). Confirmed live: Upwork gives each individual
   *  freelancer their OWN personal organization id on every message
   *  (not one shared EurosHub id), so this can't be a simple id
   *  comparison against the connection's own organizationId. Instead
   *  matches the sender's first name against the room's own name —
   *  Upwork formats `roomName` as "{client name}, ..." (confirmed live
   *  across every room checked, e.g. room "Jamie Yoon, Deli Inc- Home"
   *  has messages from "Jamie Y." — the client — and "Zainab Z." — the
   *  freelancer). A sender whose first name doesn't match the room name
   *  is treated as our side. This is a derived heuristic, not a real
   *  Upwork field — the real `senderName` is always stored alongside it
   *  regardless, so a wrong guess here never hides who actually said
   *  what (see UpworkApiRoomMessage's own schema docblock). Public (Part:
   *  Delayed Responses real "unresponded" fix, 2026-10-23) — reused by
   *  UpworkRoomsService.listDelayedResponses directly against a room's
   *  own cached `latestMessageFrom`/`roomName`, without needing the full
   *  per-message history synced for every room. */
  /** Everyone in the room except whoever created it (Part: Delayed
   *  Responses team inboxes, 2026-10-26) — confirmed live the "owner"
   *  role is always the client, so excluding it leaves only agency-side
   *  participants: the specific freelancer(s) actually assigned plus
   *  EurosHub's own agency admin, who shows up on every room regardless.
   *  Deduped (the same person can appear twice — once under their own
   *  personal Upwork org, once under "EurosHub" — confirmed live). Which
   *  of these names are a real, grouped freelancer (vs. the admin, vs. a
   *  name with no group set yet) is resolved later in
   *  UpworkRoomsService, not here — this just caches the raw candidates. */
  private extractAssignedProfileNames(roomUsers: { role: string | null; user: { name: string | null } | null }[] | null): string[] {
    if (!roomUsers) return [];
    const names = new Set<string>();
    for (const ru of roomUsers) {
      if (ru.role === "owner") continue;
      if (ru.user?.name) names.add(ru.user.name);
    }
    return [...names];
  }

  isSenderAgencySide(senderName: string | null, roomName: string | null): boolean {
    if (!senderName) return false;
    if (!roomName) return true;
    const senderFirstName = senderName.trim().split(/\s+/)[0]?.toLowerCase();
    if (!senderFirstName) return true;
    return !roomName.toLowerCase().includes(senderFirstName);
  }

  /** Fetches and upserts real message history for one room (Part: Rooms
   *  & Messages chat history, 2026-10-23) — used both by the quick
   *  tick's top-30 sweep above and by UpworkRoomsService's on-demand
   *  fetch when a room is opened with nothing cached yet. */
  async syncMessagesForRoom(connectionRow: UpworkApiConnection, upworkRoomId: string, roomName: string | null): Promise<void> {
    await this.connection.withFreshTokenOnAuthFailure(connectionRow.orgId, async ({ accessToken, organizationId }) => {
      const stories = await this.graphql.getRoomStories(accessToken, organizationId, upworkRoomId, ROOM_MESSAGE_PAGE_SIZE);
      if (stories.length === 0) return;
      await this.prisma.$transaction(
        stories.map((s) => {
          const data = {
            message: s.message,
            senderName: s.user?.name ?? null,
            senderOrgName: s.organization?.name ?? null,
            senderIsAgency: this.isSenderAgencySide(s.user?.name ?? null, roomName),
            createdAt: toDate(s.createdDateTime) ?? new Date(),
          };
          return this.prisma.upworkApiRoomMessage.upsert({
            where: { orgId_upworkStoryId: { orgId: connectionRow.orgId, upworkStoryId: s.id } },
            create: { orgId: connectionRow.orgId, upworkRoomId, upworkStoryId: s.id, ...data },
            update: data,
          });
        }),
      );
    });
  }
}
