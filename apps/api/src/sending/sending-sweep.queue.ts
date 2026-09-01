import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";

/** Same cadence as AGENT_EXECUTION_SWEEP_INTERVAL_MS — a send retry due "in
 *  a few minutes" doesn't need sub-minute precision. */
export const SENDING_SWEEP_INTERVAL_MS = 2 * 60 * 1000;

/** Registers the repeatable sweep tick — same split as
 *  AgentExecutionSweepQueue vs AgentExecutionSweepWorker: this owns the
 *  Queue/repeatable-job registration, the worker owns the sweep logic. */
@Injectable()
export class SendingSweepQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue = new Queue(QUEUE_NAMES.SENDING_SWEEP, { connection: getRedisConnection() });

  async onModuleInit() {
    await this.queue.add("tick", {}, { repeat: { every: SENDING_SWEEP_INTERVAL_MS }, jobId: "sending-sweep-tick" });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
