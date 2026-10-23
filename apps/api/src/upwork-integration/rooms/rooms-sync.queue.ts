import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "../../common/queue/redis-connection";

/** Two-tier sync (Part: Upwork API integration — Rooms & Messages
 *  two-tier sync, originally 2026-10-23, re-tuned 2026-10-23 same day
 *  after confirming Upwork's REAL documented limit — 40,000 requests/
 *  day, 300/min, 10/sec per IP (support.upwork.com/hc/en-us/articles/
 *  115015933428) — is nothing like the ~500/day figure this was first
 *  tuned against (that number turned out to be Connects, an unrelated
 *  bidding currency, not an API quota). QUICK tier cost is dominated by
 *  the fixed 2-calls-per-tick room-list walk — going from 15min to
 *  1min just multiplies that fixed cost 15x (192/day -> 2,880/day),
 *  still ~7% of the real daily budget. The variable message-content
 *  calls (up to 30/tick, only for rooms with a genuinely newer
 *  message) are bounded by real message-arrival rate, not tick
 *  frequency, so polling faster doesn't multiply THAT cost. FULL tier
 *  (whole-catalog walk + full-replace cleanup) tightened 6h -> 1h:
 *  ~82 calls/tick * 24 = ~1,968/day at the current ~4,085-room count.
 *  Combined with every other Upwork domain's own 6h sync, total usage
 *  stays well under 10,000/day — comfortable margin below the real
 *  40,000/day ceiling even as the room count grows. */
export const UPWORK_ROOMS_QUICK_SYNC_INTERVAL_MS = 60 * 1000;
export const UPWORK_ROOMS_FULL_SYNC_INTERVAL_MS = 60 * 60 * 1000;

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
