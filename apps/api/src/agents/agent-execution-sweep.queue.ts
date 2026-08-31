import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";

/** How often the sweep checks for due retries / stale locks. Coarser than
 *  EMAIL_SYNC_INTERVAL_MS (30s) on purpose — a retry due "in ~1 hour" doesn't
 *  need sub-minute precision, and this keeps the query cheap. */
export const AGENT_EXECUTION_SWEEP_INTERVAL_MS = 2 * 60 * 1000;

/** Registers the repeatable sweep tick — same split as EmailHubSyncQueue vs
 *  EmailHubSyncWorker: this owns the Queue/repeatable-job registration, the
 *  worker owns the actual sweep logic. */
@Injectable()
export class AgentExecutionSweepQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue = new Queue(QUEUE_NAMES.AGENT_EXECUTION_SWEEP, { connection: getRedisConnection() });

  async onModuleInit() {
    await this.queue.add(
      "tick",
      {},
      { repeat: { every: AGENT_EXECUTION_SWEEP_INTERVAL_MS }, jobId: "agent-execution-sweep-tick" },
    );
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
