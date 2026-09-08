import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";

/** Same cadence as AGENT_EXECUTION_SWEEP/SENDING_SWEEP — a wait-timer stuck
 *  for a few extra minutes doesn't need sub-minute precision, and this keeps
 *  the query cheap. */
export const PIPELINE_WAIT_SWEEP_INTERVAL_MS = 2 * 60 * 1000;

/** Registers the repeatable sweep tick — same split as
 *  AgentExecutionSweepQueue vs AgentExecutionSweepWorker: this owns the
 *  Queue/repeatable-job registration, the worker owns the actual sweep
 *  logic (which lives on SequencerService.recoverStuckWaits). */
@Injectable()
export class PipelineWaitSweepQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue = new Queue(QUEUE_NAMES.PIPELINE_WAIT_SWEEP, { connection: getRedisConnection() });

  async onModuleInit() {
    await this.queue.add(
      "tick",
      {},
      { repeat: { every: PIPELINE_WAIT_SWEEP_INTERVAL_MS }, jobId: "pipeline-wait-sweep-tick" },
    );
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
