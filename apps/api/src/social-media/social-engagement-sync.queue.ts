import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";

/** 10 minutes (Part: Social Hub Engagement, 2026-09-07) -- same cadence as
 *  SOCIAL_INBOX_SYNC, for the same reason: comments deserve a timely
 *  response but not second-by-second polling, and this is poll-only in V1
 *  (no webhook path yet — see the worker's own docblock). */
export const SOCIAL_ENGAGEMENT_SYNC_INTERVAL_MS = 10 * 60 * 1000;

/** Registers the repeatable "sync comments" tick -- same split as every
 *  other Queue/Worker pair in this module: this class only owns the Queue
 *  instance and the repeatable-job registration,
 *  SocialEngagementSyncWorker does the actual work. */
@Injectable()
export class SocialEngagementSyncQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue: Queue;

  constructor() {
    this.queue = new Queue(QUEUE_NAMES.SOCIAL_ENGAGEMENT_SYNC, { connection: getRedisConnection() });
  }

  async onModuleInit() {
    await this.queue.add(
      "tick",
      {},
      { repeat: { every: SOCIAL_ENGAGEMENT_SYNC_INTERVAL_MS }, jobId: "social-engagement-sync-tick" },
    );
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
