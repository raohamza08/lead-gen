import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { EmailAccount, Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { NotificationsService } from "../notifications/notifications.service";
import { ImapReaderProvider } from "./readers/imap-reader.provider";
import { FetchedMessage } from "./mailbox-reader.interface";
import { EmailLeadClassifierService } from "./email-lead-classifier.service";

/** Strips reply/forward prefixes and collapses whitespace so "Re: Re: Fwd:
 *  Website proposal" and "Website proposal" thread together when no
 *  Message-ID chain is available (some providers omit References entirely
 *  on forwarded/older mail). Not perfect — a genuinely new message that
 *  happens to share a subject with an old thread will merge into it — but
 *  the same trade-off every email client's fallback threading makes. */
function normalizeSubject(subject: string): string {
  return subject.replace(/^\s*(re|fwd?|fw)\s*:\s*/i, "").trim() || "(no subject)";
}

/**
 * Consumes the single repeatable "tick" job from EmailHubSyncQueue (Part:
 * Email Hub) — one job execution walks every inboundSyncEnabled account
 * sequentially, rather than one BullMQ job per account. At V1 scale
 * (15-100 mailboxes, polled every few minutes) this is simpler than
 * managing N independent repeatable-job registrations and their lifecycle
 * as accounts are toggled on/off, and one account's transient slowness just
 * delays the rest of that tick's accounts by a few seconds, not a real
 * problem at this cadence. If sync volume ever demands real parallelism,
 * this is the point to split into per-account jobs — the reader interface
 * doesn't change either way.
 */
@Injectable()
export class EmailHubSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailHubSyncWorker.name);
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reader: ImapReaderProvider,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
    private readonly leadClassifier: EmailLeadClassifierService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(QUEUE_NAMES.EMAIL_SYNC, () => this.tick(), {
      connection: getRedisConnection(),
      concurrency: 1, // one tick at a time — accounts inside a tick are sequential by design (see class docblock)
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`email-sync tick failed: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async tick() {
    const accounts = await this.prisma.emailAccount.findMany({
      where: { inboundSyncEnabled: true, status: "ACTIVE" },
    });
    for (const account of accounts) {
      try {
        await this.syncAccount(account);
      } catch (err) {
        await this.handleAccountFailure(account, err as Error);
      }
    }
  }

  private async syncAccount(account: EmailAccount) {
    const { inbox, sent } = await this.reader.sync(account, {
      inbox: account.lastImapUid ? String(account.lastImapUid) : null,
      sent: account.lastImapUidSent ? String(account.lastImapUidSent) : null,
    });

    // Sent messages persist through the same path as inbound ones —
    // findOrCreateThreadId's Message-ID/References chain links a sent reply
    // back into the thread it replied to automatically, no separate
    // "outbound thread" concept needed.
    for (const message of [...inbox.messages, ...sent.messages]) {
      await this.persistMessage(account, message);
    }

    const cursorUpdate: Prisma.EmailAccountUpdateInput = {};
    if (inbox.newCursor !== null) cursorUpdate.lastImapUid = Number(inbox.newCursor);
    if (sent.newCursor !== null) cursorUpdate.lastImapUidSent = Number(sent.newCursor);
    if (Object.keys(cursorUpdate).length > 0) {
      await this.prisma.emailAccount.update({ where: { id: account.id }, data: cursorUpdate });
    }

    if (inbox.messages.length > 0) {
      this.realtime.emitToOrg(account.orgId, "emailHub.messageReceived", {
        accountId: account.id,
        count: inbox.messages.length,
      });
    }
  }

  /** Auth failures are permanent for this account until a human fixes the
   *  credentials — same "don't retry-storm a dead connection" reasoning as
   *  ComplianceGateError in email-provider.service.ts, just IMAP's own
   *  signal for it. imapflow's AuthenticationFailure class is declared in its type
   *  definitions but not actually exported from the package's runtime
   *  module (only `ImapFlow` is — confirmed by reading lib/imap-flow.js's
   *  module.exports directly, not assumed from the .d.ts), so `instanceof`
   *  isn't usable here; the thrown error does reliably carry
   *  `authenticationFailed: true` as an own property (set in
   *  imapflow/lib/tools.js), which is what every IMAP auth failure sets
   *  regardless of the export gap. Anything without that flag is treated as
   *  transient: logged, left for the next tick to retry, no account-status
   *  change. */
  private async handleAccountFailure(account: EmailAccount, err: Error) {
    if ((err as { authenticationFailed?: boolean }).authenticationFailed === true) {
      this.logger.warn(`IMAP auth failed for ${account.address}, suspending inbound sync: ${err.message}`);
      await this.prisma.emailAccount.update({
        where: { id: account.id },
        data: { status: "SUSPENDED" },
      });
      await this.notifications.notify(account.orgId, {
        type: "EMAIL_SYNC_AUTH_FAILED",
        severity: "ERROR",
        message: `Inbox sync for ${account.address} was suspended — IMAP login failed. Check the password in Settings > Email Hub > Accounts.`,
      });
      return;
    }
    this.logger.error(`Sync failed for ${account.address} (will retry next tick): ${err.message}`);
  }

  /** Finds the thread this message belongs to (Message-ID/References/
   *  In-Reply-To chain, falling back to normalized subject), then inserts
   *  the message — a duplicate providerMessageId for this account is
   *  silently skipped via the unique constraint rather than erroring the
   *  whole tick over one already-seen message. */
  private async persistMessage(account: EmailAccount, message: FetchedMessage) {
    const { threadId, isNewThread } = await this.findOrCreateThreadId(account, message);

    let created: { id: string };
    try {
      created = await this.prisma.inboundEmailMessage.create({
        data: {
          threadId,
          accountId: account.id,
          providerMessageId: message.providerMessageId,
          messageIdHeader: message.messageIdHeader,
          fromName: message.fromName,
          fromEmail: message.fromEmail,
          toEmails: message.toEmails,
          ccEmails: message.ccEmails,
          bccEmails: message.bccEmails,
          subject: message.subject,
          bodyText: message.bodyText,
          bodyHtml: message.bodyHtml,
          receivedAt: message.receivedAt,
          folder: message.folder,
          hasAttachments: message.hasAttachments,
          attachments: message.attachments as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
    } catch (err) {
      // P2002 = unique constraint violation on [accountId, providerMessageId]
      // — the message was already synced (e.g. a re-poll after a crash
      // before the cursor was persisted). Anything else is a real error.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") throw err;
      return;
    }

    await this.prisma.inboundEmailThread.update({
      where: { id: threadId },
      data: { lastMessageAt: message.receivedAt },
    });

    // Only a thread's first message gets classified (Part: Lead Room) — a
    // reply in an already-seen thread doesn't need re-judging, and the
    // thread's own leadId (once a human confirms) is the durable signal that
    // this sender is already handled. Fire-and-forget: a classifier outage
    // must never slow down or break mail sync. Sent messages never trigger
    // this — a thread that starts with something *we* sent (a cold email
    // whose reply hasn't landed yet) has no inbound sender to judge, and
    // classifying our own outgoing copy as a "possible lead" would be nonsense.
    if (isNewThread && message.folder !== "SENT") {
      this.leadClassifier
        .classifyAndTag(account.orgId, created.id, {
          fromName: message.fromName,
          fromEmail: message.fromEmail,
          subject: message.subject,
          bodyText: message.bodyText,
        })
        .catch((err) =>
          this.logger.warn(`Lead classification dispatch failed for message ${created.id}: ${(err as Error).message}`),
        );
    }
  }

  private async findOrCreateThreadId(
    account: EmailAccount,
    message: FetchedMessage,
  ): Promise<{ threadId: string; isNewThread: boolean }> {
    const parentIds = [message.inReplyTo, ...(message.references ?? [])].filter((id): id is string => !!id);

    if (parentIds.length > 0) {
      const parent = await this.prisma.inboundEmailMessage.findFirst({
        where: { accountId: account.id, messageIdHeader: { in: parentIds } },
        select: { threadId: true },
      });
      if (parent) return { threadId: parent.threadId, isNewThread: false };
    }

    const subject = normalizeSubject(message.subject);
    const existingThread = await this.prisma.inboundEmailThread.findFirst({
      where: { accountId: account.id, subject },
      orderBy: { lastMessageAt: "desc" },
    });
    if (existingThread) return { threadId: existingThread.id, isNewThread: false };

    const created = await this.prisma.inboundEmailThread.create({
      data: {
        orgId: account.orgId,
        accountId: account.id,
        subject,
        participants: [{ name: message.fromName, email: message.fromEmail }] as unknown as Prisma.InputJsonValue,
        lastMessageAt: message.receivedAt,
      },
    });
    return { threadId: created.id, isNewThread: true };
  }
}
