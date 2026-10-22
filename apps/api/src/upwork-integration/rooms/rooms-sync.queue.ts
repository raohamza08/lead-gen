import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../../common/queue/redis-connection";

/** 30 minutes -- finer-grained than other 6h Upwork syncs since this is
 *  real-time client/freelancer conversation activity, where staleness
 *  matters more than for financial/historical data. */
export const UPWORK_ROOMS_SYNC_INTERVAL_MS = 30 * 60 * 1000;

@Injectable()
export class UpworkRoomsSyncQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue: Queue;

  constructor() {
    this.queue = new Queue(QUEUE_NAMES.UPWORK_ROOMS_SYNC, { connection: getRedisConnection() });
  }

  async onModuleInit() {
    await this.queue.add("tick", {}, { repeat: { every: UPWORK_ROOMS_SYNC_INTERVAL_MS }, jobId: "upwork-rooms-sync-tick" });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
