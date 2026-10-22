import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../../common/queue/redis-connection";

/** 6 hours -- same cadence as UpworkConnectsSyncQueue/UpworkProposalsSyncQueue. */
export const UPWORK_INVITES_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class UpworkInvitesSyncQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue: Queue;

  constructor() {
    this.queue = new Queue(QUEUE_NAMES.UPWORK_INVITES_SYNC, { connection: getRedisConnection() });
  }

  async onModuleInit() {
    await this.queue.add(
      "tick",
      {},
      { repeat: { every: UPWORK_INVITES_SYNC_INTERVAL_MS }, jobId: "upwork-invites-sync-tick" },
    );
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
