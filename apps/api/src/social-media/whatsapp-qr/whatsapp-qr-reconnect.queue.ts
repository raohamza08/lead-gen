import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../../common/queue/redis-connection";

/** Fine-grained on purpose -- a genuine network blip should recover within
 *  about a minute, not sit until some slower shared sweep interval gets to
 *  it (same reasoning as EMAIL_ACCOUNT_RESUME_SWEEP_INTERVAL_MS). */
export const WHATSAPP_QR_RECONNECT_SWEEP_INTERVAL_MS = 60 * 1000;

/** Registers the repeatable reconnect-sweep tick -- same split as every
 *  other sweep pair in this codebase: this owns the Queue/repeatable-job
 *  registration, WhatsAppQrReconnectWorker owns the actual retry logic. */
@Injectable()
export class WhatsAppQrReconnectQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue = new Queue(QUEUE_NAMES.WHATSAPP_QR_RECONNECT, { connection: getRedisConnection() });

  async onModuleInit() {
    await this.queue.add("tick", {}, { repeat: { every: WHATSAPP_QR_RECONNECT_SWEEP_INTERVAL_MS }, jobId: "whatsapp-qr-reconnect-sweep-tick" });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
