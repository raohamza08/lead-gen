import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";

/** Once a day is plenty -- a long-lived Meta token lives ~60 days, and the
 *  worker itself only acts on tokens inside a 7-day expiry window (see
 *  meta-ads-token-refresh.worker.ts), so daily checks give many chances to
 *  catch it before it actually lapses. */
export const META_ADS_TOKEN_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class MetaAdsTokenRefreshQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue: Queue;

  constructor() {
    this.queue = new Queue(QUEUE_NAMES.META_ADS_TOKEN_REFRESH, { connection: getRedisConnection() });
  }

  async onModuleInit() {
    await this.queue.add("tick", {}, { repeat: { every: META_ADS_TOKEN_REFRESH_INTERVAL_MS }, jobId: "meta-ads-token-refresh-tick" });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
