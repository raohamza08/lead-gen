import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";
import { SequencerService } from "./sequencer.service";

/**
 * Consumes PipelineWaitSweepQueue's repeatable tick (Part: pipeline wait
 * sweep, 2026-09-08) — the missing self-healing half of the "next stage"
 * countdown shown on a lead card: WAIT_TIMERS jobs are one-shot delayed
 * BullMQ jobs with no `attempts` configured, so a job lost to a Redis
 * eviction, a one-off exception, or anything else that isn't a clean
 * success previously meant nothing would ever pick that lead back up —
 * its countdown would finish and just sit there, needing a human to
 * manually advance the stage. See SequencerService.recoverStuckWaits for
 * the actual reconciliation logic; this worker only owns the tick.
 */
@Injectable()
export class PipelineWaitSweepWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PipelineWaitSweepWorker.name);
  private worker?: Worker;

  constructor(private readonly sequencer: SequencerService) {}

  onModuleInit() {
    this.worker = new Worker(QUEUE_NAMES.PIPELINE_WAIT_SWEEP, () => this.sequencer.recoverStuckWaits(), {
      connection: getRedisConnection(),
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`pipeline-wait sweep tick failed: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
