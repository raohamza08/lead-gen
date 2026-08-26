import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { SocialAccount } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";
import { SocialProviderRegistryService } from "./providers/social-provider-registry.service";
import { SocialInboxIngestService } from "./social-inbox-ingest.service";

/** Only platforms with a real listConversations()/listMessages()
 *  implementation (Part: Unified Social Media DM Monitoring) — LinkedIn/X/
 *  TikTok/YouTube throw PlatformNotConfiguredError for these, so calling
 *  them every tick would just be a wasted round trip that always fails. */
const POLLABLE_PLATFORMS = ["FACEBOOK", "INSTAGRAM"] as const;

/**
 * Reconciliation pass over every connected Facebook/Instagram account's
 * conversations (Part: Unified Social Media DM Monitoring) — same
 * single-repeatable-tick, sequential-accounts shape as EmailHubSyncWorker,
 * same reasoning (simpler than N independent per-account schedules at this
 * volume, one slow account just delays the rest of the tick). This is the
 * fallback path; SocialWebhookController is what actually delivers most
 * messages in real time.
 */
@Injectable()
export class SocialInboxSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SocialInboxSyncWorker.name);
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: SocialProviderRegistryService,
    private readonly ingest: SocialInboxIngestService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(QUEUE_NAMES.SOCIAL_INBOX_SYNC, () => this.tick(), {
      connection: getRedisConnection(),
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`social-inbox-sync tick failed: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async tick() {
    const accounts = await this.prisma.socialAccount.findMany({
      where: { platform: { in: [...POLLABLE_PLATFORMS] }, status: "CONNECTED" },
    });
    for (const account of accounts) {
      try {
        await this.syncAccount(account);
      } catch (err) {
        this.logger.warn(`Social inbox sync failed for ${account.platform}:${account.username}: ${(err as Error).message}`);
      }
    }
  }

  private async syncAccount(account: SocialAccount) {
    const provider = this.registry.for(account.platform);
    const conversations = await provider.listConversations(account);

    for (const conv of conversations) {
      if (!conv.participantExternalId) continue; // couldn't resolve who the other party is -- nothing to key a conversation on

      // listMessages needs the platform's own thread id
      // (conv.externalConversationId), never persisted -- only
      // conv.participantExternalId is used as our storage/dedup key, kept
      // consistent with what the webhook path naturally provides (see
      // SocialPlatformProvider.Conversation's own docblock on this split).
      const messages = await provider.listMessages(account, conv.externalConversationId);
      for (const message of messages) {
        await this.ingest.persistMessage(account, {
          externalConversationId: conv.participantExternalId,
          contactExternalId: conv.participantExternalId,
          contactName: conv.participantName,
          contactProfileImageUrl: conv.participantAvatarUrl,
          externalMessageId: message.externalMessageId,
          fromUs: message.fromUs,
          senderName: message.senderName,
          messageText: message.text,
          sentAt: message.sentAt,
        });
      }
    }

    await this.prisma.socialAccount.update({ where: { id: account.id }, data: { lastSyncAt: new Date() } });
  }
}
