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
    const due = await this.prisma.whatsAppQrSession.findMany({
      where: { status: "DISCONNECTED", lastDisconnectedAt: { lte: cutoff } },
      take: 20,
    });

    for (const session of due) {
      await this.sessions.connect(session.socialAccountId).catch((err) =>
        this.logger.warn(`Reconnect attempt failed for WhatsApp QR account ${session.socialAccountId}: ${(err as Error).message}`),
      );
    }
  }
}
