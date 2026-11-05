import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { DEFAULT_QUEUE_JOB_OPTIONS, getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";

/** 90 seconds -- frequent enough that a lead whose wait just elapsed isn't
 *  sitting idle for long, coarse enough that a quiet tick (no due work, no
 *  budget to spend) stays cheap (Part: Claude-budget-aware drip scheduler,
 *  2026-11-05). */
export const DRAFT_SCHEDULER_INTERVAL_MS = 90 * 1000;

/** Registers the repeatable drip-scheduler tick — same split as every other
 *  sweep pair in this codebase: this owns the Queue/repeatable-job
 *  registration, DraftSchedulerWorker owns the actual pacing logic. */
@Injectable()
export class DraftSchedulerQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue = new Queue(QUEUE_NAMES.DRAFT_SCHEDULER, { connection: getRedisConnection(), defaultJobOptions: DEFAULT_QUEUE_JOB_OPTIONS });

  async onModuleInit() {
    await this.queue.add("tick", {}, { repeat: { every: DRAFT_SCHEDULER_INTERVAL_MS }, jobId: "draft-scheduler-tick" });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
