import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../../common/queue/redis-connection";

/** 6 hours -- same cadence as every other Upwork sync queue. */
export const UPWORK_TRANSACTIONS_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class UpworkTransactionsSyncQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue: Queue;

  constructor() {
    this.queue = new Queue(QUEUE_NAMES.UPWORK_TRANSACTIONS_SYNC, { connection: getRedisConnection() });
  }

  async onModuleInit() {
    await this.queue.add(
      "tick",
      {},
      { repeat: { every: UPWORK_TRANSACTIONS_SYNC_INTERVAL_MS }, jobId: "upwork-transactions-sync-tick" },
    );
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
