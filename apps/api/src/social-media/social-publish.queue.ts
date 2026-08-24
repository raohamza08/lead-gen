import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";

/** Posts are time-sensitive in a way inbound mail sync isn't — an operator
 *  scheduling a post for a specific minute expects it to go out close to
 *  that minute, not "sometime in the next few minutes." 60s balances that
 *  against not hammering the DB with a full due-post scan every few seconds. */
export const SOCIAL_PUBLISH_INTERVAL_MS = 60 * 1000;

/** Registers the repeatable "publish due posts" tick — same split as
 *  EmailHubSyncQueue/Worker: this class only owns the Queue instance and the
 *  repeatable-job registration, SocialPublishWorker does the actual work. */
@Injectable()
export class SocialPublishQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue: Queue;

  constructor() {
    this.queue = new Queue(QUEUE_NAMES.SOCIAL_PUBLISH, { connection: getRedisConnection() });
  }

  async onModuleInit() {
    await this.queue.add("tick", {}, { repeat: { every: SOCIAL_PUBLISH_INTERVAL_MS }, jobId: "social-publish-tick" });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
