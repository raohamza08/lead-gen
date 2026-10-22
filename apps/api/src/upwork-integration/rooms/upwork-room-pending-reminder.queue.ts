import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../../common/queue/redis-connection";

/** Every 2 minutes — pure DB read (no Upwork API calls), so there's no
 *  rate-limit/budget reason to run this coarser; a tighter tick just
 *  means a message crossing someone's threshold gets its reminder
 *  sooner rather than up to several minutes late (Part: Rooms &
 *  Messages desktop notifications, 2026-10-23). */
export const UPWORK_ROOM_PENDING_REMINDER_INTERVAL_MS = 2 * 60 * 1000;

@Injectable()
export class UpworkRoomPendingReminderQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue = new Queue(QUEUE_NAMES.UPWORK_ROOM_PENDING_REMINDER, { connection: getRedisConnection() });

  async onModuleInit() {
    await this.queue.add(
      "tick",
      {},
      { repeat: { every: UPWORK_ROOM_PENDING_REMINDER_INTERVAL_MS }, jobId: "upwork-room-pending-reminder-tick" },
    );
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
