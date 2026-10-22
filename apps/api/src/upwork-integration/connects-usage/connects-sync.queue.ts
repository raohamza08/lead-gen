import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../../common/queue/redis-connection";

/** 6 hours -- a Connects balance changes on discrete events (bids,
 *  invitations, refunds), not continuously, so this doesn't need Meta Ads'
 *  3h cadence; infrequent enough to stay well clear of Upwork's published
 *  rate ceiling (300 req/min, 40,000/day) even with the per-connection
 *  paginated history fetch the worker does alongside the balance read. */
export const UPWORK_CONNECTS_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

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
