import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../../common/queue/redis-connection";

/** Two-tier sync (Part: Upwork API integration — Rooms & Messages
 *  two-tier sync, 2026-10-23, explicit user request — "set the chat
 *  sync time to 15 mins") — see UpworkRoomsSyncService's own docblock
 *  for the full reasoning: a plain 15-minute FULL sync would cost
 *  ~7,900 Upwork API calls/day against this org's real 4,084-room
 *  catalog (confirmed live), ~16x the user's stated ~500/day budget.
 *  QUICK (15 min) only walks the first couple of pages — the most
 *  recently active rooms (`roomList`'s confirmed default order) — for
 *  ~4 calls/tick. FULL (6h, matching every other Upwork domain's own
 *  cadence) walks the whole catalog and does the full-replace cleanup. */
export const UPWORK_ROOMS_QUICK_SYNC_INTERVAL_MS = 15 * 60 * 1000;
export const UPWORK_ROOMS_FULL_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class UpworkRoomsSyncQueue implements OnModuleInit, OnModuleDestroy {
  private readonly queue: Queue;

  constructor() {
    this.queue = new Queue(QUEUE_NAMES.UPWORK_ROOMS_SYNC, { connection: getRedisConnection() });
  }

  async onModuleInit() {
    await this.queue.add("quick-tick", {}, { repeat: { every: UPWORK_ROOMS_QUICK_SYNC_INTERVAL_MS }, jobId: "upwork-rooms-quick-sync-tick" });
    await this.queue.add("full-tick", {}, { repeat: { every: UPWORK_ROOMS_FULL_SYNC_INTERVAL_MS }, jobId: "upwork-rooms-full-sync-tick" });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
