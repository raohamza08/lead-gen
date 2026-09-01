import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";
import { PrismaService } from "../common/prisma/prisma.service";
import { SendingQueue } from "./sending-queue.queue";
import { STALE_SENDING_MS } from "./sending.worker";

/**
 * Consumes SendingSweepQueue's repeatable tick (Part: Preparation Pipeline /
 * Sending Queue, 2026-09-01) — the send-side counterpart to
 * AgentExecutionSweepWorker, same two jobs in the same pass:
 *
 * 1. Reclaim SENDING rows a crashed worker abandoned — reset to
 *    RETRY_SCHEDULED so the message isn't stuck "sending" forever.
 * 2. Re-dispatch RETRY_SCHEDULED rows whose nextSendRetryAt has passed by
 *    re-adding them to SendingQueue — SendingWorker's own atomic claim is
 *    what makes a duplicate re-add harmless if it's already been picked up.
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
  }
}
