import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { DEFAULT_QUEUE_JOB_OPTIONS, getRedisConnection, QUEUE_NAMES } from "../../common/queue/redis-connection";

/** 6 hours -- same cadence as UpworkConnectsSyncQueue; proposals/bids don't
 *  need finer granularity than that for a dashboard-level view. */
export const UPWORK_PROPOSALS_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class UpworkProposalsSyncQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue: Queue;

  constructor() {
    this.queue = new Queue(QUEUE_NAMES.UPWORK_PROPOSALS_SYNC, { connection: getRedisConnection(), defaultJobOptions: DEFAULT_QUEUE_JOB_OPTIONS });
  }

  async onModuleInit() {
    await this.queue.add(
      "tick",
      {},
      { repeat: { every: UPWORK_PROPOSALS_SYNC_INTERVAL_MS }, jobId: "upwork-proposals-sync-tick" },
    );
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
