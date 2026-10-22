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

/** Hard ceiling on pages fetched per sync tick, same safety reasoning as
 *  every other Upwork sync service's own cap. 200 pages * 50/page =
 *  10,000 rooms per tick. */
const MAX_PAGES = 200;
const PAGE_SIZE = 50;

/**
 * Rooms & Messages sync logic (spec Module K, Part: Upwork API
 * integration — Rooms & Messages domain, 2026-10-23) — same split as
 * every other Upwork sync service. `roomList` requires no filter and
 * returns rooms org-wide, cursor-paginated. Stops on an empty page, not
 * on `hasNextPage` (same reasoning as UpworkInvitesSyncService — don't
 * assume this field is reliable without re-confirming; stopping on an
 * empty page is the one pattern confirmed safe across every Upwork query
 * tested this session). READ ONLY, see
 * UpworkGraphQLClient.getRoomListPage's own docblock — this never calls
 * any of Upwork's real send-message mutations.
 *
 * Full-replace, not append-only: after upserting every room seen this
 * pass, deletes any `UpworkApiRoom` row for this org whose
 * `upworkRoomId` wasn't in that set. Needed because of a real incident
 * (2026-10-23): this connection was bound to the wrong Upwork tenant
 * (the user's personal account, not the EurosHub agency) for a while,
 * so ~242 personal-account rooms were already stored under this orgId.
 * Pointing the connection at the real agency tenant returns a
 * completely different room-ID set (confirmed live) — a plain upsert
 * would leave both accounts' rooms mixed together permanently instead
 * of showing only what's really in the now-correct account. This also
 * self-heals the normal case of a room actually disappearing/getting
 * archived on Upwork's side.
 */
@Injectable()
export class UpworkRoomsSyncService {
  private readonly logger = new Logger(UpworkRoomsSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connection: UpworkApiConnectionService,
    private readonly graphql: UpworkGraphQLClient,
  ) {}

  /** Manual "sync now" entry point (Part: Upwork API integration — Rooms
   *  & Messages domain, 2026-10-23, added after a real org-switch
   *  incident where waiting out the 30-minute tick wasn't acceptable).
   *  Looks up the connection itself rather than taking a row, since the
   *  controller only has a user/orgId, not the full row. */
  async syncOrgNow(orgId: string): Promise<void> {
    const connectionRow = await this.prisma.upworkApiConnection.findUnique({ where: { orgId } });
    if (!connectionRow || connectionRow.status !== "CONNECTED") {
      throw new Error("Upwork API is not connected for this organization");
    }
    await this.syncConnection(connectionRow);
  }

  async syncConnection(connectionRow: UpworkApiConnection): Promise<void> {
    try {
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
        } while (after && pages < MAX_PAGES);
      });
      // Full-replace (see docblock above) — drop anything stored for this
      // org that this pass didn't see, so a tenant switch or an
      // archived-on-Upwork's-side room can't linger forever.
      await this.prisma.upworkApiRoom.deleteMany({
        where: { orgId: connectionRow.orgId, upworkRoomId: { notIn: seenRoomIds } },
      });
      await this.prisma.upworkApiConnection.update({
        where: { id: connectionRow.id },
        data: { lastSyncAt: new Date(), lastSyncError: null },
      });
    } catch (err) {
      const message = (err as Error).message.slice(0, 300);
      this.logger.warn(`Rooms sync failed for org ${connectionRow.orgId}: ${message}`);
      await this.prisma.upworkApiConnection.update({
        where: { id: connectionRow.id },
        data: { lastSyncError: message },
      });
      throw err;
    }
  }
}
