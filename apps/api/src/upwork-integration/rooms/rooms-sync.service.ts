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
   *  upserting each one. Returns the set of room IDs seen, so a full
   *  pass can use it for the full-replace delete — a partial (quick)
   *  pass must NOT use it for that, since "not seen in the first 2
   *  pages" says nothing about whether a room still exists. */
  private async upsertPages(connectionRow: UpworkApiConnection, maxPages: number): Promise<string[]> {
    const seenRoomIds: string[] = [];
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
            };
            return this.prisma.upworkApiRoom.upsert({
              where: { orgId_upworkRoomId: { orgId: connectionRow.orgId, upworkRoomId: e.node.id } },
              create: { orgId: connectionRow.orgId, upworkRoomId: e.node.id, ...data },
              update: data,
            });
          }),
        );
        seenRoomIds.push(...page.edges.map((e) => e.node.id));
        pages += 1;
        after = page.pageInfo?.endCursor ?? null;
      } while (after && pages < maxPages);
    });
    return seenRoomIds;
  }

  /** FULL sync — every room, full-replace delete. Run every 6 hours by
   *  the worker's "full-tick" job. */
  async syncConnectionFull(connectionRow: UpworkApiConnection): Promise<void> {
    try {
      const seenRoomIds = await this.upsertPages(connectionRow, MAX_PAGES);
      await this.prisma.upworkApiRoom.deleteMany({
        where: { orgId: connectionRow.orgId, upworkRoomId: { notIn: seenRoomIds } },
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

  /** QUICK sync — just the most-recently-active rooms, no deletion. Run
   *  every 15 minutes by the worker's "quick-tick" job. */
  async syncConnectionQuick(connectionRow: UpworkApiConnection): Promise<void> {
    try {
      await this.upsertPages(connectionRow, QUICK_SYNC_PAGES);
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
}
