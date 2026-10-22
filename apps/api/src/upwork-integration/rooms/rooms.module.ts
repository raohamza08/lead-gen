import { Module } from "@nestjs/common";
import { UpworkSharedModule } from "../shared/upwork-shared.module";
import { UpworkConnectionModule } from "../connection/connection.module";
import { UpworkRoomsController } from "./rooms.controller";
import { UpworkRoomsService } from "./rooms.service";
import { UpworkRoomsSyncQueue } from "./rooms-sync.queue";
import { UpworkRoomsSyncWorker } from "./rooms-sync.worker";
import { UpworkRoomsSyncService } from "./rooms-sync.service";
import { UpworkRoomPendingReminderQueue } from "./upwork-room-pending-reminder.queue";
import { UpworkRoomPendingReminderWorker } from "./upwork-room-pending-reminder.worker";

/** Rooms & Messages domain (spec Module K) — LIVE, READ ONLY (Part:
 *  Upwork API integration — Rooms & Messages domain, 2026-10-23).
 *  Self-contained, same shape as every other live domain module. */
@Module({
  imports: [UpworkSharedModule, UpworkConnectionModule],
  controllers: [UpworkRoomsController],
  providers: [
    UpworkRoomsService,
    UpworkRoomsSyncQueue,
    UpworkRoomsSyncWorker,
    UpworkRoomsSyncService,
    UpworkRoomPendingReminderQueue,
    UpworkRoomPendingReminderWorker,
  ],
  exports: [UpworkRoomsService],
})
export class UpworkRoomsModule {}
