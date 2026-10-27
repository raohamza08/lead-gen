import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../../common/queue/redis-connection";

/** 1 hour (Part: Connects usage monitoring, 2026-10-28, explicit user
 *  request after spotting the dashboard under-reporting invite spend by
 *  ~360 connects against Upwork's own live page) -- was 6 hours, which left
 *  the dashboard up to 6h stale against real activity on an account that
 *  routinely spends hundreds of connects a day. Still comfortably clear of
 *  Upwork's published rate ceiling (300 req/min, 40,000/day) even with the
 *  per-connection paginated history fetch the worker does alongside the
 *  balance read -- one connection syncing hourly is a few requests/hour,
 *  nowhere near either ceiling. */
export const UPWORK_CONNECTS_SYNC_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class UpworkConnectsSyncQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue: Queue;

  constructor() {
    this.queue = new Queue(QUEUE_NAMES.UPWORK_CONNECTS_SYNC, { connection: getRedisConnection() });
  }

  async onModuleInit() {
    await this.queue.add(
      "tick",
      {},
      { repeat: { every: UPWORK_CONNECTS_SYNC_INTERVAL_MS }, jobId: "upwork-connects-sync-tick" },
    );
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
