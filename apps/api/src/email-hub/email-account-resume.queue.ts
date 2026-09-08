import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";

/** Every minute -- fine-grained on purpose, so the 5-minute suspend cooldown
 *  (EMAIL_ACCOUNT_RESUME_COOLDOWN_MS) is honored within about a minute of
 *  it actually elapsing, not overshot by a coarser sweep interval the way
 *  the other 2-minute sweeps' cooldowns tolerate. */
export const EMAIL_ACCOUNT_RESUME_SWEEP_INTERVAL_MS = 60 * 1000;

/** Registers the repeatable resume-sweep tick — same split as every other
 *  sweep pair in this codebase: this owns the Queue/repeatable-job
 *  registration, EmailAccountResumeWorker owns the actual resume logic. */
@Injectable()
export class EmailAccountResumeQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue = new Queue(QUEUE_NAMES.EMAIL_ACCOUNT_RESUME_SWEEP, { connection: getRedisConnection() });

  async onModuleInit() {
    await this.queue.add(
      "tick",
      {},
      { repeat: { every: EMAIL_ACCOUNT_RESUME_SWEEP_INTERVAL_MS }, jobId: "email-account-resume-sweep-tick" },
    );
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
