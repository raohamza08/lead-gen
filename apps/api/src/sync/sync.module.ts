import { Module } from "@nestjs/common";
import { SyncService } from "./sync.service";
import { SheetsSyncWorker } from "./sheets-sync.worker";
import { ClickupSyncWorker } from "./clickup-sync.worker";
import { GoogleSheetsClient } from "./google-sheets.client";
import { ClickupClient } from "./clickup.client";

@Module({
  providers: [SyncService, SheetsSyncWorker, ClickupSyncWorker, GoogleSheetsClient, ClickupClient],
  exports: [SyncService, ClickupClient],
})
export class SyncModule {}
