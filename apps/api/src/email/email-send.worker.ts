import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Job, Worker } from "bullmq";
import { PrismaService } from "../common/prisma/prisma.service";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";
import { EmailProviderService, ComplianceGateError } from "./email-provider.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { NotificationsService } from "../notifications/notifications.service";

/**
 * Consumes the email-send queue (Part E5). ComplianceGateError is treated as
 * permanent (Part E7) — no retry, the message is marked FAILED and logged for
 * a human to look at (e.g. mailbox exhausted, recipient suppressed) rather than
 * hammered with exponential backoff that will never succeed.
 */
@Injectable()
export class EmailSendWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailSendWorker.name);
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailProvider: EmailProviderService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(
      QUEUE_NAMES.EMAIL_SEND,
      (job) => this.handle(job),
      { connection: getRedisConnection(), concurrency: 5 },
    );
    this.worker.on("failed", (job, err) => {
      if (job) void this.onFailed(job, err);
    });
  }

  /** BullMQ's "failed" event fires after every attempt — a transient send
   *  error that still has retries left is expected and already logged inside
   *  handle()'s catch; this only escalates once retries are truly exhausted
   *  (Part: autonomous system — "notify administrators only if automatic
   *  recovery fails"). ComplianceGateError never reaches here: handle()
   *  returns instead of throwing for that case, so BullMQ never sees it as
   *  a failure to retry. */
  private async onFailed(job: Job<{ emailMessageId: string }>, err: Error) {
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) return;

    const message = await this.prisma.emailMessage.findUnique({
      where: { id: job.data.emailMessageId },
      select: { leadId: true, lead: { select: { orgId: true } } },
    });
    if (!message) return;
    await this.notifications.notify(message.lead.orgId, {
      type: "EMAIL_SEND_FAILED",
      severity: "ERROR",
      message: `Email send failed after ${job.attemptsMade} attempts: ${err.message}`,
      leadId: message.leadId,
    });
    this.realtime.emitToOrg(message.lead.orgId, "email.failed", {
      leadId: message.leadId,
      emailMessageId: job.data.emailMessageId,
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async handle(job: Job<{ emailMessageId: string }>) {
    const { emailMessageId } = job.data;
    const message = await this.prisma.emailMessage.findUniqueOrThrow({ where: { id: emailMessageId } });

    try {
      const { accountId, providerMessageId } = await this.emailProvider.sendForLead(
        message.leadId,
        message.subject,
        message.bodyHtml,
        message.id,
      );

      await this.prisma.emailMessage.update({
        where: { id: emailMessageId },
        data: { status: "SENT", sentAt: new Date(), accountId },
      });
      await this.prisma.emailEvent.create({
        data: { messageId: emailMessageId, eventType: "SENT", meta: { providerMessageId } },
      });
      const lead = await this.prisma.lead.update({
        where: { id: message.leadId },
        data: { lastActivityAt: new Date() },
        select: { orgId: true },
      });
      this.realtime.emitToOrg(lead.orgId, "email.sent", { leadId: message.leadId, emailMessageId });
    } catch (err) {
      if (err instanceof ComplianceGateError) {
        this.logger.warn(`Compliance gate blocked send for message ${emailMessageId}: ${err.message}`);
        await this.prisma.emailMessage.update({ where: { id: emailMessageId }, data: { status: "FAILED" } });
        const lead = await this.prisma.lead.findUnique({ where: { id: message.leadId }, select: { orgId: true } });
        if (lead) {
          this.realtime.emitToOrg(lead.orgId, "email.failed", { leadId: message.leadId, emailMessageId });
        }
        return; // permanent failure — do not throw, so BullMQ does not retry
      }
      throw err; // transient — BullMQ retries per the queue's configured backoff
    }
  }
}
