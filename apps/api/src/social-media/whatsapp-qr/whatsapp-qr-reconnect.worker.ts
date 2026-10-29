import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../../common/queue/redis-connection";
import { PrismaService } from "../../common/prisma/prisma.service";
import { WhatsAppQrSessionManagerService } from "./whatsapp-qr-session-manager.service";

/** A DISCONNECTED session sits this long before a retry is attempted again
 *  -- short and uncapped (no attempt limit), same explicit choice
 *  EmailAccountResumeWorker makes: if the underlying cause is persistent
 *  (WhatsApp's servers down, a real network problem), retrying every
 *  cooldown IS the intended behavior, not a bug to guard against. */
export const WHATSAPP_QR_RECONNECT_COOLDOWN_MS = 30 * 1000;

/**
 * Consumes WhatsAppQrReconnectQueue's repeatable tick -- retries any
 * WhatsAppQrSession stuck DISCONNECTED (a non-logout socket close) past its
 * cooldown. Deliberately excludes LOGGED_OUT: that status means the linked
 * device was actually removed/the saved auth is dead, and no amount of
 * retrying reconnects it -- it needs a human to scan a fresh QR from the
 * Numbers tab (Part: WhatsApp Team Inbox, 2026-10-26).
 *
 * Now also retries QR_PENDING (Part: WhatsApp Team Inbox reliability,
 * 2026-10-29, explicit user request -- "make sure the connection doesn't
 * go down until I disconnect them"). QR_PENDING used to be a dead end
 * nothing here ever revisited -- confirmed live, two real numbers sat at
 * a QR prompt nobody was shown for ~2 days. calling connect() again is
 * safe here: the auth state is still on disk (not wiped the way a real
 * LOGGED_OUT is), so a retry either resumes cleanly with no new QR needed
 * at all, or regenerates a FRESH one (WhatsApp's QR expires in roughly a
 * minute, so a single static code persisted once would go stale long
 * before anyone opens the Numbers tab to scan it).
 */
@Injectable()
export class WhatsAppQrReconnectWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppQrReconnectWorker.name);
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: WhatsAppQrSessionManagerService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(QUEUE_NAMES.WHATSAPP_QR_RECONNECT, () => this.tick(), {
      connection: getRedisConnection(),
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`whatsapp-qr reconnect sweep tick failed: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async tick() {
    const cutoff = new Date(Date.now() - WHATSAPP_QR_RECONNECT_COOLDOWN_MS);
    // `updatedAt` rather than lastDisconnectedAt/lastQrAt specifically --
    // it advances on EITHER status (Prisma's own @updatedAt), so one
    // cutoff check correctly throttles both a plain disconnect and a
    // QR_PENDING retry without needing two separate queries.
    const due = await this.prisma.whatsAppQrSession.findMany({
      where: { status: { in: ["DISCONNECTED", "QR_PENDING"] }, updatedAt: { lte: cutoff } },
      take: 20,
    });

    for (const session of due) {
      // forceReconnect, not connect -- a QR_PENDING session still holds a
      // stale "live" socket object that was never deleted (only a real
      // close event does that), so a plain connect() here would hit its
      // own no-op guard and do nothing (see forceReconnect's own
      // docblock).
      await this.sessions.forceReconnect(session.socialAccountId).catch((err) =>
        this.logger.warn(`Reconnect attempt failed for WhatsApp QR account ${session.socialAccountId}: ${(err as Error).message}`),
      );
    }
  }
}
