import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";

/** 6 hours (Part: Social Hub Analytics, 2026-09-07) -- follower counts and
 *  reach don't meaningfully change minute to minute, and every tick costs a
 *  real call against each platform's rate-limited insights endpoint per
 *  connected account. Frequent enough that the Analytics page's "as of"
 *  timestamp is never more than a few hours stale; infrequent enough to
 *  stay well clear of any platform's per-app rate ceiling even with dozens
 *  of connected accounts. */
export const SOCIAL_ANALYTICS_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Registers the repeatable "snapshot analytics" tick -- same split as
 *  every other Queue/Worker pair in this module: this class only owns the
 *  Queue instance and the repeatable-job registration,
 *  SocialAnalyticsSyncWorker does the actual work. */
@Injectable()
export class SocialAnalyticsSyncQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue: Queue;

  constructor() {
    this.queue = new Queue(QUEUE_NAMES.SOCIAL_ANALYTICS_SYNC, { connection: getRedisConnection() });
  }

  async onModuleInit() {
    await this.queue.add(
      "tick",
      {},
      { repeat: { every: SOCIAL_ANALYTICS_SYNC_INTERVAL_MS }, jobId: "social-analytics-sync-tick" },
    );
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
