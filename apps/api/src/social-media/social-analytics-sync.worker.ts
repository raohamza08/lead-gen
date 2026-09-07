import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { SocialAccount } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";
import { SocialProviderRegistryService } from "./providers/social-provider-registry.service";
import { AccountInsights } from "./providers/social-platform-provider.interface";

/**
 * Consumes the repeatable "tick" job from SocialAnalyticsSyncQueue -- one
 * pass over every CONNECTED account whose provider actually implements
 * getAccountInsights (Facebook/Instagram/X/YouTube; LinkedIn/TikTok/
 * WhatsApp are skipped outright, not attempted-and-failed, since they never
 * declared the capability). Same "one tick walks every due row
 * sequentially" shape as SocialPublishWorker/SocialTokenRefreshWorker.
 *
 * Two real API calls per eligible account, both best-effort and
 * independent: getAccountInsights() for the platform's own account-level
 * fields (followers, etc.), and listFeed() to compute a real, live
 * engagement aggregate from actual recent posts rather than trusting a
 * single Insights metric that platforms deprecate often. Either can fail
 * (a metric renamed upstream, a token mid-refresh) without blocking the
 * other or aborting the whole account -- a snapshot with some nulls is
 * still useful; skipping the account entirely because one call failed
 * would throw away the half that worked.
 */
@Injectable()
export class SocialAnalyticsSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SocialAnalyticsSyncWorker.name);
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: SocialProviderRegistryService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(QUEUE_NAMES.SOCIAL_ANALYTICS_SYNC, () => this.tick(), {
      connection: getRedisConnection(),
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`social-analytics-sync tick failed: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async tick() {
    const accounts = await this.prisma.socialAccount.findMany({ where: { status: "CONNECTED" } });

    for (const account of accounts) {
      const provider = this.registry.for(account.platform);
      if (!provider.capabilities.analytics || !provider.getAccountInsights) continue;

      try {
        await this.snapshotOne(account);
      } catch (err) {
        this.logger.error(`Unexpected error snapshotting analytics for ${account.platform} account ${account.id}: ${(err as Error).message}`);
      }
    }
  }

  private async snapshotOne(account: SocialAccount) {
    const provider = this.registry.for(account.platform);
    let insights: AccountInsights = {};
    try {
      insights = await provider.getAccountInsights!(account);
    } catch (err) {
      this.logger.warn(`getAccountInsights failed for ${account.platform} account ${account.id}: ${(err as Error).message}`);
    }

    // Real engagement, computed from actual recent posts rather than a
    // single account-level Insights metric — only ever runs for a platform
    // whose listFeed() genuinely returns data (Facebook/Instagram today; X
    // and YouTube throw PlatformNotConfiguredError here, caught and simply
    // left out of the snapshot, same as every other "platform doesn't
    // support this" case elsewhere in this module).
    let likeCount: number | undefined;
    let commentCount: number | undefined;
    try {
      const feed = await provider.listFeed(account);
      if (feed.length > 0) {
        likeCount = feed.reduce((sum, p) => sum + p.likeCount, 0);
        commentCount = feed.reduce((sum, p) => sum + p.commentCount, 0);
      }
    } catch {
      // Expected for platforms without a real feed-read API — see
      // x.provider.ts/youtube.provider.ts's own listFeed implementations.
    }

    const engagementRate =
      insights.followerCount && insights.followerCount > 0 && likeCount !== undefined && commentCount !== undefined
        ? ((likeCount + commentCount) / insights.followerCount) * 100
        : undefined;

    await this.prisma.socialAccountAnalyticsSnapshot.create({
      data: {
        accountId: account.id,
        followerCount: insights.followerCount,
        followingCount: insights.followingCount,
        postsCount: insights.postsCount,
        reach: insights.reach,
        impressions: insights.impressions,
        likeCount,
        commentCount,
        engagementRate,
      },
    });
  }
}
