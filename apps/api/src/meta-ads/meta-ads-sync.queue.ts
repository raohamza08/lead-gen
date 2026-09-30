import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";

/** 3 hours -- ad performance data changes far more often than the Social
 *  Media module's follower-count snapshots (6h, see
 *  SOCIAL_ANALYTICS_SYNC_INTERVAL_MS), and Meta's own attribution windows
 *  mean yesterday's numbers can keep shifting for a few days -- frequent
 *  enough that the dashboard's "last synced" is never far stale, infrequent
 *  enough to stay well clear of the Marketing API's per-app rate ceiling. */
export const META_ADS_SYNC_INTERVAL_MS = 3 * 60 * 60 * 1000;

@Injectable()
export class MetaAdsSyncQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue: Queue;

  constructor() {
    this.queue = new Queue(QUEUE_NAMES.META_ADS_SYNC, { connection: getRedisConnection() });
  }

  async onModuleInit() {
    await this.queue.add("tick", {}, { repeat: { every: META_ADS_SYNC_INTERVAL_MS }, jobId: "meta-ads-sync-tick" });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
