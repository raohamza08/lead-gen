import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Job, Worker } from "bullmq";
import { PrismaService } from "../common/prisma/prisma.service";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";
import { EmailProviderService, ComplianceGateError } from "./email-provider.service";

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
  ) {}

  onModuleInit() {
    this.worker = new Worker(
      QUEUE_NAMES.EMAIL_SEND,
      (job) => this.handle(job),
      { connection: getRedisConnection(), concurrency: 5 },
    );
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
      await this.prisma.lead.update({ where: { id: message.leadId }, data: { lastActivityAt: new Date() } });
    } catch (err) {
      if (err instanceof ComplianceGateError) {
        this.logger.warn(`Compliance gate blocked send for message ${emailMessageId}: ${err.message}`);
        await this.prisma.emailMessage.update({ where: { id: emailMessageId }, data: { status: "FAILED" } });
        return; // permanent failure — do not throw, so BullMQ does not retry
      }
      throw err; // transient — BullMQ retries per the queue's configured backoff
    }
  }
}
