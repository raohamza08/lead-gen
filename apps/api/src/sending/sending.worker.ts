import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Job, Worker } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";
import { PrismaService } from "../common/prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { EmailProviderService } from "../email/email-provider.service";
import type { SendingJob } from "./sending-queue.queue";
import { CLAIMABLE_FOR_SENDING } from "./email-status-transitions";

/** Exponential from ~2 minutes, capped at ~1 hour — same shape as
 *  AgentExecutionService's backoffMs, reused here for send retries. */
function backoffMs(attempt: number): number {
  const minutes = Math.min(60, 2 * 2 ** (attempt - 1));
  return minutes * 60 * 1000;
}

/** After this many failed attempts, stop retrying and leave the message
 *  FAILED (already set by sendMessageNow) for a human to inspect/resend
 *  manually — matches AgentExecutionService's "retry until success or a
 *  max-retry policy is reached." */
export const MAX_SEND_ATTEMPTS = 5;

/** A SENDING row locked longer than this is treated as a crashed worker's
 *  abandoned claim, not a real in-flight send — see SendingSweepWorker. */
export const STALE_SENDING_MS = 10 * 60 * 1000;

/**
 * Consumes SendingQueue (Part: Preparation Pipeline / Sending Queue,
 * 2026-09-01) — the one place a message is actually handed to
 * EmailProviderService.sendForLead now, whether it arrived here via
 * immediate release (no schedule) or a scheduler-created SendingSession.
 *
 * The atomic updateMany below is the duplicate-send guard (requirement #6):
 * a scheduler re-fire, a worker restart replaying an in-flight job, or the
 * sweep re-queuing the same message can never result in two sends, because
 * only the caller whose UPDATE actually flips the row's status gets
 * `count > 0` — the same compare-and-swap AgentExecutionService.start()
 * already uses for agent locks.
 */
@Injectable()
export class SendingWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SendingWorker.name);
  private worker?: Worker<SendingJob>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly emailProvider: EmailProviderService,
  ) {}

  onModuleInit() {
    this.worker = new Worker<SendingJob>(QUEUE_NAMES.SENDING_QUEUE, (job) => this.handle(job), {
      connection: getRedisConnection(),
      concurrency: 5,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`sending job ${job?.id} failed: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async handle(job: Job<SendingJob>) {
    const { emailMessageId } = job.data;
    const claim = await this.prisma.emailMessage.updateMany({
      where: { id: emailMessageId, status: { in: CLAIMABLE_FOR_SENDING } },
      data: { status: "SENDING", sendingLockedAt: new Date() },
    });
    if (claim.count === 0) {
      this.logger.debug(`Skipping ${emailMessageId} — already claimed or no longer sendable`);
      return;
    }

    const message = await this.prisma.emailMessage.findUniqueOrThrow({
      where: { id: emailMessageId },
      include: { lead: { select: { orgId: true } } },
    });

    // sendMessageNow already writes SENT/FAILED + sentAt/failureReason and
    // fires email.sent/email.failed — this worker only layers retry
    // scheduling and session bookkeeping on top of that real outcome.
    const result = await this.emailProvider.sendMessageNow(emailMessageId);

    if (result.status === "SENT") {
      if (message.sendingSessionId) await this.bumpSession(message.sendingSessionId, message.lead.orgId, "successful");
      return;
    }

    await this.onSendFailed(emailMessageId, message.lead.orgId, message.sendingSessionId, message.sendRetryCount);
  }

  private async onSendFailed(
    emailMessageId: string,
    orgId: string,
    sendingSessionId: string | null,
    priorAttempts: number,
  ) {
    const attempt = priorAttempts + 1;
    const terminal = attempt >= MAX_SEND_ATTEMPTS;

    if (terminal) {
      // Leave the FAILED status sendMessageNow already set — this is a
      // human-visible terminal state, not something to keep retrying forever.
      await this.prisma.emailMessage.update({
        where: { id: emailMessageId },
        data: { sendRetryCount: attempt, sendingLockedAt: null },
      });
      // A real, timestamped EmailEvent{FAILED} — the analytics dashboard's
      // "Failed Today"/failure trend reads this, not EmailMessage.createdAt
      // (Part: Lead Upload Analytics / Email Performance / Ignore Groups,
      // 2026-09-01). Written only here, once retries are exhausted — a
      // transient attempt that succeeds on retry 2 must never inflate the
      // failure count just because attempt 1 briefly set status=FAILED.
      await this.prisma.emailEvent.create({ data: { messageId: emailMessageId, eventType: "FAILED" } });
    } else {
      await this.prisma.emailMessage.update({
        where: { id: emailMessageId },
        data: {
          status: "RETRY_SCHEDULED",
          sendRetryCount: attempt,
          nextSendRetryAt: new Date(Date.now() + backoffMs(attempt)),
          sendingLockedAt: null,
        },
      });
      this.realtime.emitToOrg(orgId, "sendingQueue.updated", { emailMessageId, status: "RETRY_SCHEDULED" });
      // A retryable failure doesn't move the session's counters yet — only a
      // message's TERMINAL outcome (sent, or exhausted-failed) counts toward
      // successful/failed, so a batch's session never reports "done" before
      // every message has actually reached a final state (requirement #7:
      // one failed message must never fail the whole batch).
      return;
    }

    if (sendingSessionId) await this.bumpSession(sendingSessionId, orgId, "failed");
  }

  private async bumpSession(sendingSessionId: string, orgId: string, field: "successful" | "failed") {
    const session = await this.prisma.sendingSession.update({
      where: { id: sendingSessionId },
      data: { [field]: { increment: 1 } },
    });
    const done = session.successful + session.failed;
    const completed = done >= session.totalLeads;
    if (completed && session.status !== "COMPLETED") {
      await this.prisma.sendingSession.update({ where: { id: sendingSessionId }, data: { status: "COMPLETED", completedAt: new Date() } });
    }
    this.realtime.emitToOrg(orgId, "sendingSession.updated", {
      sendingSessionId,
      successful: session.successful,
      failed: session.failed,
      totalLeads: session.totalLeads,
      status: completed ? "COMPLETED" : session.status,
    });
  }
}
