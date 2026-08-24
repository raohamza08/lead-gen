import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";

/** How often the sync worker polls every inboundSyncEnabled mailbox. A
 *  single shared tick rather than a per-account schedule (see class docblock
 *  on EmailHubSyncWorker for why) — 3 minutes balances "the unified inbox
 *  feels current" against not hammering 20-100 IMAP servers with needless
 *  connections every few seconds. */
export const EMAIL_SYNC_INTERVAL_MS = 3 * 60 * 1000;

/**
 * Registers the repeatable "check every mailbox" job (Part: Email Hub). The
 * actual per-account sync work lives in EmailHubSyncWorker — this class only
 * owns the Queue instance and the repeatable-job registration, same split as
 * every other queue/worker pair in this codebase (e.g.
 * SequencerService's waitQueue vs. its own handleWaitJob).
 */
@Injectable()
export class EmailHubSyncQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue: Queue;

  constructor() {
    this.queue = new Queue(QUEUE_NAMES.EMAIL_SYNC, { connection: getRedisConnection() });
  }

  async onModuleInit() {
    // BullMQ dedupes a repeatable job by its {name, repeat, jobId} triple —
    // re-registering on every API restart is a no-op, not a growing pile of
    // duplicate scheduled jobs.
    await this.queue.add(
      "tick",
      {},
      { repeat: { every: EMAIL_SYNC_INTERVAL_MS }, jobId: "email-sync-tick" },
    );
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
