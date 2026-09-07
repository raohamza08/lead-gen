import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";

/** 15 minutes (Part: Connected Social Accounts token vault, 2026-09-07) --
 *  far more frequent than any provider's token lifetime requires on its own
 *  (the shortest, X/TikTok, is measured in hours), but cheap: the worker's
 *  query only ever touches accounts within REFRESH_LOOKAHEAD_MS of expiring,
 *  so a tick with nothing due does one indexed query and returns. Tightening
 *  this doesn't create load; it only shrinks the worst-case staleness window
 *  between a token actually needing refresh and this catching it. */
export const SOCIAL_TOKEN_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

/** Registers the repeatable "refresh due tokens" tick -- same split as
 *  SocialPublishQueue/Worker: this class only owns the Queue instance and
 *  the repeatable-job registration, SocialTokenRefreshWorker does the work. */
@Injectable()
export class SocialTokenRefreshQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue: Queue;

  constructor() {
    this.queue = new Queue(QUEUE_NAMES.SOCIAL_TOKEN_REFRESH, { connection: getRedisConnection() });
  }

  async onModuleInit() {
    await this.queue.add(
      "tick",
      {},
      { repeat: { every: SOCIAL_TOKEN_REFRESH_INTERVAL_MS }, jobId: "social-token-refresh-tick" },
    );
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
