import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";

/** Every 6 hours -- the cadence this drives is in whole days (2-day
 *  follow-up window), so a coarse tick is enough; no reason to poll as
 *  tightly as the minute-level sweeps elsewhere in this codebase. */
export const UPWORK_FOLLOW_UP_REMINDER_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Registers the repeatable follow-up-reminder tick (Part: Upwork follow-up
 *  reminders, 2026-09-30) -- same split as every other sweep pair in this
 *  codebase: this owns the Queue/repeatable-job registration,
 *  UpworkFollowUpReminderWorker owns the actual reminder logic. */
@Injectable()
export class UpworkFollowUpReminderQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue = new Queue(QUEUE_NAMES.UPWORK_FOLLOW_UP_REMINDER, { connection: getRedisConnection() });

  async onModuleInit() {
    await this.queue.add(
      "tick",
      {},
      { repeat: { every: UPWORK_FOLLOW_UP_REMINDER_INTERVAL_MS }, jobId: "upwork-follow-up-reminder-tick" },
    );
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
