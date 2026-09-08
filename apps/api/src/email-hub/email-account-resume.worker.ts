import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";
import { PrismaService } from "../common/prisma/prisma.service";
import { TransactionalEmailService } from "../email/transactional-email.service";

/** How long a SUSPENDED account sits before this worker tries resuming it
 *  (Part: email account auto-resume agent, 2026-09-08) -- an explicit,
 *  deliberately short cooldown rather than the escalating backoff the other
 *  sweeps in this codebase use: the user wants to know immediately (the
 *  suspend-time email EmailHubSyncWorker already sends) and get a fast,
 *  visible retry, not a slow, quiet one. No attempt cap either, by the same
 *  explicit choice -- if the credentials are genuinely wrong, this will
 *  keep re-suspending and re-emailing every cycle, which IS the intended
 *  signal to go fix the password rather than a silent infinite retry: the
 *  user sees every single occurrence, not just the first and the last. */
export const EMAIL_ACCOUNT_RESUME_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Consumes EmailAccountResumeQueue's repeatable tick -- the automatic half
 * of "press the resume button" (Part: email account auto-resume agent,
 * 2026-09-08). Flips a SUSPENDED account back to ACTIVE once its cooldown
 * has passed; EmailHubSyncWorker's own 30-second poll picks it up from
 * there and attempts a real sync -- if that succeeds, this worker's own
 * "resumed, healthy" email is the confirmation; if it fails again,
 * EmailHubSyncWorker re-suspends it and the whole cycle repeats.
 */
@Injectable()
export class EmailAccountResumeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailAccountResumeWorker.name);
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionalEmail: TransactionalEmailService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(QUEUE_NAMES.EMAIL_ACCOUNT_RESUME_SWEEP, () => this.tick(), {
      connection: getRedisConnection(),
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`email-account resume sweep tick failed: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async tick() {
    const cutoff = new Date(Date.now() - EMAIL_ACCOUNT_RESUME_COOLDOWN_MS);
    const due = await this.prisma.emailAccount.findMany({
      where: { status: "SUSPENDED", suspendedAt: { lte: cutoff } },
      take: 50,
    });

    for (const account of due) {
      await this.prisma.emailAccount.update({
        where: { id: account.id },
        data: { status: "ACTIVE", suspendedAt: null },
      });
      this.logger.warn(`Auto-resumed ${account.address} after ${EMAIL_ACCOUNT_RESUME_COOLDOWN_MS / 60000}min cooldown`);

      // Same "any other active mailbox, never the outreach rotation" choice
      // as EmailHubSyncWorker's own suspend-time alert -- see that method's
      // docblock for why.
      const admin = await this.prisma.user.findFirst({ where: { orgId: account.orgId, isPrimaryAdmin: true }, select: { email: true } });
      if (admin?.email) {
        await this.transactionalEmail.send(
          account.orgId,
          admin.email,
          `Email account resumed: ${account.address}`,
          `<p><strong>${account.address}</strong> has been automatically resumed by the email reviewer agent and the system is healthy.</p>` +
            `<p>Inbox sync will pick it back up on its next check. If it was a real password problem, you'll get another ` +
            `suspension email shortly -- otherwise, no further action needed.</p>`,
        );
      }
    }
  }
}
