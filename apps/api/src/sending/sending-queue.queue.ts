import { Injectable } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";

export interface SendingJob {
  emailMessageId: string;
}

/**
 * Centralized dispatch queue for every send in the 5-email sequence (Part:
 * Preparation Pipeline / Sending Queue, 2026-09-01) — replaces the old
 * synchronous EmailProviderService.sendMessageNow call that used to happen
 * inside the same request that created or approved a draft. One queue, one
 * worker (SendingWorker), used identically whether a message was released
 * immediately (no schedule configured) or swept into a SendingSession by
 * SendingSchedulerService.
 *
 * No retries at this layer — SendingWorker models retries explicitly via
 * RETRY_SCHEDULED + the sweep tick (same reasoning as ImportEnrichmentQueue:
 * retrying the outer BullMQ job too would just restart the wait loop
 * needlessly).
 */
@Injectable()
export class SendingQueue {
  private readonly queue = new Queue<SendingJob>(QUEUE_NAMES.SENDING_QUEUE, {
    connection: getRedisConnection(),
    defaultJobOptions: { attempts: 1 },
  });

  add(job: SendingJob) {
    return this.queue.add("send", job);
  }
}
