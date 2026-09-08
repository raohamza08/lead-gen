import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";

/** One minute -- frequent enough that a real outage is caught within a
 *  couple of ticks, not so frequent it meaningfully loads the health
 *  endpoint (Part: comprehensive operational alerting, 2026-09-08). */
export const AI_WORKERS_HEALTH_INTERVAL_MS = 60 * 1000;

/** Registers the repeatable health-check tick — same Queue/Worker split as
 *  every other sweep pair in this codebase. */
@Injectable()
export class AiWorkersHealthQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue = new Queue(QUEUE_NAMES.AI_WORKERS_HEALTH, { connection: getRedisConnection() });

  async onModuleInit() {
    await this.queue.add(
      "tick",
      {},
      { repeat: { every: AI_WORKERS_HEALTH_INTERVAL_MS }, jobId: "ai-workers-health-tick" },
    );
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
