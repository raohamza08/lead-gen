import { Module } from "@nestjs/common";
import { UpworkSharedModule } from "../shared/upwork-shared.module";
import { UpworkConnectionModule } from "../connection/connection.module";
import { UpworkWorkHistoryController } from "./work-history.controller";
import { UpworkWorkHistoryService } from "./work-history.service";
import { UpworkWorkHistorySyncQueue } from "./work-history-sync.queue";
import { UpworkWorkHistorySyncWorker } from "./work-history-sync.worker";
import { UpworkWorkHistorySyncService } from "./work-history-sync.service";

/** Work History domain (spec Module T) — LIVE (Part: Upwork API
 *  integration — Work History domain, 2026-10-23). Self-contained, same
 *  shape as every other live domain module. */
@Module({
  imports: [UpworkSharedModule, UpworkConnectionModule],
  controllers: [UpworkWorkHistoryController],
  providers: [UpworkWorkHistoryService, UpworkWorkHistorySyncQueue, UpworkWorkHistorySyncWorker, UpworkWorkHistorySyncService],
  exports: [UpworkWorkHistoryService],
})
export class UpworkWorkHistoryModule {}
