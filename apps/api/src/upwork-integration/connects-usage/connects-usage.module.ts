import { Module } from "@nestjs/common";
import { UpworkSharedModule } from "../shared/upwork-shared.module";
import { UpworkConnectsUsageController } from "./connects-usage.controller";
import { UpworkConnectsUsageService } from "./connects-usage.service";
import { UpworkConnectsSyncQueue } from "./connects-sync.queue";
import { UpworkConnectsSyncWorker } from "./connects-sync.worker";
import { UpworkConnectsSyncService } from "./connects-sync.service";

/**
 * Connects usage domain — self-contained module (Part: Upwork API
 * integration — modular architecture pass, 2026-10-22): read-side service
 * (DB-only, no live Upwork calls), sync Queue/Worker/Service (owns talking
 * to Upwork on a 6h schedule — decrypts the connection's token directly via
 * EncryptionService, doesn't need UpworkApiConnectionService injected), and
 * the controller, all in one place. Only depends on UpworkSharedModule (for
 * the GraphQL client) — no dependency on UpworkConnectionModule or any
 * other domain module, so this can be developed/tested/removed
 * independently without touching the connection core.
 */
@Module({
  imports: [UpworkSharedModule],
  controllers: [UpworkConnectsUsageController],
  providers: [UpworkConnectsUsageService, UpworkConnectsSyncQueue, UpworkConnectsSyncWorker, UpworkConnectsSyncService],
})
export class UpworkConnectsUsageModule {}
