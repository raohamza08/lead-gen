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

/**
 * Rooms & Messages sync logic (spec Module K, Part: Upwork API
 * integration — Rooms & Messages domain, 2026-10-23) — same split as
 * every other Upwork sync service. `roomList` requires no filter and
 * returns every room org-wide in one call (no pagination walk needed for
 * EurosHub's current volume — confirmed live totalCount: 5). READ ONLY,
 * see UpworkGraphQLClient.getRoomList's own docblock — this never calls
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
        const { edges } = await this.graphql.getRoomList(accessToken, organizationId, 100);
        if (edges.length) {
          await this.prisma.$transaction(
            edges.map((e) => {
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
        }
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
