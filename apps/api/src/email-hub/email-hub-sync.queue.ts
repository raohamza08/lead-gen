import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";

/** How often the sync worker polls every inboundSyncEnabled mailbox. A
 *  single shared tick rather than a per-account schedule (see class docblock
 *  on EmailHubSyncWorker for why). Lowered from 3 minutes — at this org's
 *  real scale (single digits of mailboxes, not the 20-100 the old comment
 *  here guessed against), a fresh IMAP connection per account every 30s is
 *  light enough, and "new email takes minutes to show up" was a real
 *  complaint. True zero-latency delivery would need a persistent IMAP IDLE
 *  connection per mailbox instead of polling at all — a bigger change,
 *  not done here. */
export const EMAIL_SYNC_INTERVAL_MS = 30 * 1000;

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
    // duplicate scheduled jobs, EXCEPT when the repeat options themselves
    // change (e.g. EMAIL_SYNC_INTERVAL_MS lowered from 3min to 30s): that's
    // a different triple, so the old registration doesn't get deduped away
    // on its own and would keep firing alongside the new one. Explicitly
    // remove any stale "email-sync-tick" registration with a different
    // interval before adding the current one, so an interval change is
    // guaranteed correct rather than depending on BullMQ's exact internal
    // key hashing.
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      if (job.id === "email-sync-tick" && job.every !== String(EMAIL_SYNC_INTERVAL_MS)) {
        await this.queue.removeRepeatableByKey(job.key);
      }
    }

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
