import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { SocialAccount } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";
import { SocialProviderRegistryService } from "./providers/social-provider-registry.service";
import { SocialEngagementIngestService } from "./social-engagement-ingest.service";

/**
 * Reconciliation pass over every connected account's comments (Part: Social
 * Hub Engagement, 2026-09-07) — same single-repeatable-tick, sequential-
 * accounts shape as SocialInboxSyncWorker. Poll-only, no webhook path yet:
 * Meta's comment webhook fields (`feed`/`live_comments`) would need
 * subscribeWebhook (social-media.service.ts) to request them alongside the
 * existing `messages` subscription, which touches the DM webhook path this
 * phase was told not to disturb; a real-time comment webhook is a
 * reasonable fast-follow, not a blocker for a working Engagement Center.
 *
 * Only ever calls listComments() on a provider that actually implements it
 * (Facebook/Instagram/YouTube today) — checked directly rather than via
 * `capabilities.comments`, since X's capabilities.comments is now correctly
 * false with no listComments to call, and checking the method's presence
 * is the one check that can never drift out of sync with what's actually
 * callable.
 */
@Injectable()
export class SocialEngagementSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SocialEngagementSyncWorker.name);
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: SocialProviderRegistryService,
    private readonly ingest: SocialEngagementIngestService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(QUEUE_NAMES.SOCIAL_ENGAGEMENT_SYNC, () => this.tick(), {
      connection: getRedisConnection(),
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`social-engagement-sync tick failed: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async tick() {
    const accounts = await this.prisma.socialAccount.findMany({ where: { status: "CONNECTED" } });
    for (const account of accounts) {
      const provider = this.registry.for(account.platform);
      if (!provider.listComments) continue;

      try {
        await this.syncAccount(account);
      } catch (err) {
        this.logger.warn(`Comment sync failed for ${account.platform}:${account.username}: ${(err as Error).message}`);
      }
    }
  }

  /** Public so a manual "Sync now" trigger can reuse the exact same logic
   *  as the scheduled tick, same reasoning SocialInboxSyncWorker's own
   *  public syncAccount already establishes. */
  async syncAccount(account: SocialAccount) {
    const provider = this.registry.for(account.platform);
    const comments = await provider.listComments!(account);
    for (const comment of comments) {
      await this.ingest.persistComment(account, comment);
    }
  }
}
