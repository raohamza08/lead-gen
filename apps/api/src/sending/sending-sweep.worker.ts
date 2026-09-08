import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";
import { PrismaService } from "../common/prisma/prisma.service";
import { SendingQueue } from "./sending-queue.queue";
import { STALE_SENDING_MS } from "./sending.worker";
import { classifySendFailure } from "../analytics/failure-classifier";

/**
 * Consumes SendingSweepQueue's repeatable tick (Part: Preparation Pipeline /
 * Sending Queue, 2026-09-01) — the send-side counterpart to
 * AgentExecutionSweepWorker, same jobs in the same pass:
 *
 * 1. Reclaim SENDING rows a crashed worker abandoned — reset to
 *    RETRY_SCHEDULED so the message isn't stuck "sending" forever.
 * 2. Re-dispatch RETRY_SCHEDULED rows whose nextSendRetryAt has passed by
 *    re-adding them to SendingQueue — SendingWorker's own atomic claim is
 *    what makes a duplicate re-add harmless if it's already been picked up.
 * 3. Re-arm terminal FAILED rows whose failureReason is a capacity block,
 *    not a real failure (Part: PROVIDER_LIMIT retry fix, 2026-09-08) — see
 *    reviveProviderLimitFailures for why this exists.
 */
@Injectable()
export class SendingSweepWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SendingSweepWorker.name);
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sendingQueue: SendingQueue,
  ) {}

  onModuleInit() {
    this.worker = new Worker(QUEUE_NAMES.SENDING_SWEEP, () => this.tick(), {
      connection: getRedisConnection(),
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`sending sweep tick failed: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async tick() {
    const now = new Date();

    const reclaimed = await this.prisma.emailMessage.updateMany({
      where: { status: "SENDING", sendingLockedAt: { lt: new Date(now.getTime() - STALE_SENDING_MS) } },
      data: { status: "RETRY_SCHEDULED", nextSendRetryAt: now, sendingLockedAt: null },
    });
    if (reclaimed.count > 0) {
      this.logger.warn(`Reclaimed ${reclaimed.count} abandoned SENDING lock(s)`);
    }

    const due = await this.prisma.emailMessage.findMany({
      where: { status: "RETRY_SCHEDULED", nextSendRetryAt: { lte: now } },
      take: 100,
    });
    for (const message of due) {
      await this.sendingQueue.add({ emailMessageId: message.id });
    }

    await this.reviveProviderLimitFailures();
  }

  /**
   * Re-arms terminal FAILED messages whose failureReason is a daily/hourly
   * send-limit block, not a real send failure (Part: PROVIDER_LIMIT retry
   * fix, 2026-09-08) — SendingWorker.onSendFailed no longer lets a NEW
   * PROVIDER_LIMIT failure land here at all, but this both backfills the 83
   * real leads that got stuck under the old logic (a capacity cap that
   * exhausted all 5 short-interval retries within ~2 hours and gave up,
   * even though the cap almost certainly reset since) and stays as an
   * ongoing safety net for anything that slips through some other path.
   * `contains` filters narrow the DB scan before classifySendFailure's own
   * keyword match confirms the category — same category set, not
   * duplicated logic.
   */
  private async reviveProviderLimitFailures() {
    const candidates = await this.prisma.emailMessage.findMany({
      where: {
        status: "FAILED",
        OR: [
          { failureReason: { contains: "send limit", mode: "insensitive" } },
          { failureReason: { contains: "rate limit", mode: "insensitive" } },
          { failureReason: { contains: "quota", mode: "insensitive" } },
          { failureReason: { contains: "too many", mode: "insensitive" } },
        ],
      },
      select: { id: true, failureReason: true },
      take: 200,
    });

    const now = new Date();
    let revived = 0;
    for (const message of candidates) {
      if (!message.failureReason || classifySendFailure(message.failureReason) !== "PROVIDER_LIMIT") continue;
      await this.prisma.emailMessage.update({
        where: { id: message.id },
        data: { status: "RETRY_SCHEDULED", nextSendRetryAt: now, sendingLockedAt: null },
      });
      revived++;
    }
    if (revived > 0) {
      this.logger.warn(`Revived ${revived} FAILED message(s) stuck on a provider send-limit block`);
    }
  }
}
