import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../../common/queue/redis-connection";

export const UPWORK_FREELANCER_PROFILES_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class UpworkFreelancerProfilesSyncQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue: Queue;

  constructor() {
    this.queue = new Queue(QUEUE_NAMES.UPWORK_FREELANCER_PROFILES_SYNC, { connection: getRedisConnection() });
  }

  async onModuleInit() {
    await this.queue.add(
      "tick",
      {},
      { repeat: { every: UPWORK_FREELANCER_PROFILES_SYNC_INTERVAL_MS }, jobId: "upwork-freelancer-profiles-sync-tick" },
    );
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
