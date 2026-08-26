import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { SocialPost, SocialPostVersion, SocialAccount } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { NotificationsService } from "../notifications/notifications.service";
import { SocialProviderRegistryService } from "./providers/social-provider-registry.service";
import { mediaPublicUrl } from "./media/media-url";

type PostWithVersions = SocialPost & {
  versions: (SocialPostVersion & { account: SocialAccount })[];
  media: { media: { id: string } }[];
};

/**
 * Consumes the repeatable "tick" job from SocialPublishQueue — one job
 * execution walks every due SCHEDULED post sequentially (same reasoning as
 * EmailHubSyncWorker: simpler than N independent per-post jobs at V1 scale,
 * and one post's slow/failing publish just delays the rest of the tick by a
 * few seconds).
 *
 * A version that already has `publishedAt` set is never re-attempted, even
 * on a retried post — this is what makes Retry safe for a partially-failed
 * multi-platform post (2 of 3 accounts published, 1 failed): retrying only
 * re-attempts the one that actually failed, never double-posts the other two.
 */
@Injectable()
export class SocialPublishWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SocialPublishWorker.name);
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: SocialProviderRegistryService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(QUEUE_NAMES.SOCIAL_PUBLISH, () => this.tick(), {
      connection: getRedisConnection(),
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`social-publish tick failed: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async tick() {
    const due = await this.prisma.socialPost.findMany({
      where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
      include: {
        versions: { include: { account: true } },
        media: { include: { media: { select: { id: true } } } },
      },
    });

    for (const post of due as PostWithVersions[]) {
      // Atomic claim: skip if another process already moved this post past
      // SCHEDULED between the findMany above and here (defense in depth —
      // concurrency:1 makes this a no-op in practice at V1 scale).
      const claimed = await this.prisma.socialPost.updateMany({
        where: { id: post.id, status: "SCHEDULED" },
        data: { status: "PUBLISHING" },
      });
      if (claimed.count === 0) continue;

      try {
        await this.publishPost(post);
      } catch (err) {
        this.logger.error(`Unexpected error publishing post ${post.id}: ${(err as Error).message}`);
      }
    }
  }

  private async publishPost(post: PostWithVersions) {
    const mediaUrls = post.media.map((m) => mediaPublicUrl(m.media.id));
    let anySucceeded = false;
    let anyFailed = false;

    for (const version of post.versions) {
      if (version.publishedAt) {
        anySucceeded = true;
        continue; // already published on a prior attempt — never re-publish
      }

      if (!version.account) {
        // The account was deleted since this post was scheduled -- there is
        // nothing left to publish to, and that's a real failure, not a
        // silent skip (Part: Failed Publishing).
        await this.prisma.socialPostVersion.update({
          where: { id: version.id },
          data: { publishError: "The connected account was deleted.", lastAttemptAt: new Date() },
        });
        anyFailed = true;
        continue;
      }

      const provider = this.registry.for(version.account.platform);
      try {
        const result = await provider.publish(version.account, {
          content: version.content,
          hashtags: version.hashtags,
          mediaUrls,
        });
        await this.prisma.socialPostVersion.update({
          where: { id: version.id },
          data: { externalPostId: result.externalPostId, publishedAt: new Date(), publishError: null, lastAttemptAt: new Date() },
        });
        anySucceeded = true;
      } catch (err) {
        // Never marked published on failure — Part: Failed Publishing's
        // explicit "do not silently mark as published" requirement.
        await this.prisma.socialPostVersion.update({
          where: { id: version.id },
          data: { publishError: (err as Error).message.slice(0, 500), lastAttemptAt: new Date() },
        });
        anyFailed = true;
      }
    }

    const finalStatus = anyFailed ? "FAILED" : "PUBLISHED";
    await this.prisma.socialPost.update({ where: { id: post.id }, data: { status: finalStatus } });
    this.realtime.emitToOrg(post.orgId, "socialMedia.postUpdated", { postId: post.id, status: finalStatus });

    if (anyFailed) {
      await this.notifications.notify(post.orgId, {
        type: "SOCIAL_POST_PUBLISH_FAILED",
        message: anySucceeded
          ? `A post partially failed to publish — some accounts succeeded, others need Retry.`
          : `A scheduled post failed to publish. Check the error and Retry once fixed.`,
      });
    }
  }
}
