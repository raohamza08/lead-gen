import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";

/** The webhook (SocialWebhookController) is the primary real-time path;
 *  this reconciliation tick is only a safety net for a missed/delayed
 *  delivery, so it can run far less often than Email Hub's IMAP poll (which
 *  has no webhook alternative at all). 10 minutes balances "catches a miss
 *  reasonably fast" against not burning Graph API quota re-listing every
 *  account's conversations constantly. */
export const SOCIAL_INBOX_SYNC_INTERVAL_MS = 10 * 60 * 1000;

/** Registers the repeatable reconciliation job — same queue/worker split as
 *  EmailHubSyncQueue/EmailHubSyncWorker. */
@Injectable()
export class SocialInboxSyncQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue: Queue;

  constructor() {
    this.queue = new Queue(QUEUE_NAMES.SOCIAL_INBOX_SYNC, { connection: getRedisConnection() });
  }

  async onModuleInit() {
    await this.queue.add(
      "tick",
      {},
      { repeat: { every: SOCIAL_INBOX_SYNC_INTERVAL_MS }, jobId: "social-inbox-sync-tick" },
    );
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
