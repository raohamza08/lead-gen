import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { JwtClaims, Role } from "@leadgen/types";
import { SocialPlatform } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";

export interface AnalyticsQuery {
  accountId?: string;
  platform?: SocialPlatform;
}

/**
 * Reads SocialAccountAnalyticsSnapshot (written by SocialAnalyticsSyncWorker
 * on its own 6-hour schedule — this service only ever reads, never calls a
 * platform API itself, so an Analytics page load is always fast and never
 * burns a rate-limited insights call) (Part: Social Hub Analytics,
 * 2026-09-07).
 *
 * Access is gated by `canView`, same as SocialInboxService — Analytics is a
 * monitoring concern, not a publish/approve one, which is exactly the split
 * SocialAccountAccess.canView's own schema docblock describes it for.
 */
@Injectable()
export class SocialAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private async viewableAccountIds(user: JwtClaims): Promise<string[] | null> {
    if (user.role === Role.ADMIN) return null;
    const grants = await this.prisma.socialAccountAccess.findMany({
      where: { userId: user.sub, canView: true },
      select: { accountId: true },
    });
    return grants.map((g) => g.accountId);
  }

  private async assertViewable(user: JwtClaims, accountId: string) {
    const account = await this.prisma.socialAccount.findFirst({ where: { id: accountId, orgId: user.orgId } });
    if (!account) throw new NotFoundException("Social account not found");
    if (user.role !== Role.ADMIN) {
      const grant = await this.prisma.socialAccountAccess.findUnique({
        where: { userId_accountId: { userId: user.sub, accountId } },
      });
      if (!grant?.canView) throw new ForbiddenException("You do not have access to this account's analytics");
    }
    return account;
  }

  /** One row per visible connected account: the platform's own latest
   *  metrics (null for every field on a platform that doesn't support
   *  analytics, or on an account not synced yet — never a fabricated 0),
   *  the change since the previous snapshot, and postsPublishedByUs, which
   *  is real regardless of platform analytics support since it's counted
   *  from our own SocialPostVersion rows, not fetched from any provider. */
  async getAnalytics(user: JwtClaims, query: AnalyticsQuery) {
    const accountIds = await this.viewableAccountIds(user);
    if (query.accountId && accountIds && !accountIds.includes(query.accountId)) {
      throw new ForbiddenException("You do not have access to this account's analytics");
    }

    const accounts = await this.prisma.socialAccount.findMany({
      where: {
        orgId: user.orgId,
        status: "CONNECTED",
        ...(accountIds ? { id: { in: accountIds } } : {}),
        ...(query.accountId ? { id: query.accountId } : {}),
        ...(query.platform ? { platform: query.platform } : {}),
      },
      select: { id: true, platform: true, username: true, displayName: true, profileImageUrl: true },
      orderBy: { platform: "asc" },
    });

    return Promise.all(
      accounts.map(async (account) => {
        const [[latest, previous], postsPublishedByUs] = await Promise.all([
          this.prisma.socialAccountAnalyticsSnapshot.findMany({
            where: { accountId: account.id },
            orderBy: { capturedAt: "desc" },
            take: 2,
          }),
          this.prisma.socialPostVersion.count({ where: { accountId: account.id, publishedAt: { not: null } } }),
        ]);
        return {
          account,
          latest: latest ?? null,
          followerChange:
            latest?.followerCount != null && previous?.followerCount != null
              ? latest.followerCount - previous.followerCount
              : null,
          postsPublishedByUs,
        };
      }),
    );
  }

  /** Snapshot history for one account, newest first — the raw series a
   *  frontend trend line/sparkline plots. */
  async getAccountHistory(user: JwtClaims, accountId: string, limit = 30) {
    await this.assertViewable(user, accountId);
    return this.prisma.socialAccountAnalyticsSnapshot.findMany({
      where: { accountId },
      orderBy: { capturedAt: "desc" },
      take: limit,
    });
  }
}
