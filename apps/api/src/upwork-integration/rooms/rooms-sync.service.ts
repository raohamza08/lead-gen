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
 */
@Injectable()
export class UpworkRoomsSyncService {
  private readonly logger = new Logger(UpworkRoomsSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connection: UpworkApiConnectionService,
    private readonly graphql: UpworkGraphQLClient,
  ) {}

  async syncConnection(connectionRow: UpworkApiConnection): Promise<void> {
    try {
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
          pages += 1;
          after = page.pageInfo?.endCursor ?? null;
        } while (after && pages < MAX_PAGES);
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
