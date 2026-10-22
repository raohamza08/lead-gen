import { Module } from "@nestjs/common";
import { UpworkSharedModule } from "../shared/upwork-shared.module";
import { UpworkConnectionModule } from "../connection/connection.module";
import { UpworkConnectsUsageController } from "./connects-usage.controller";
import { UpworkConnectsUsageService } from "./connects-usage.service";
import { UpworkConnectsSyncQueue } from "./connects-sync.queue";
import { UpworkConnectsSyncWorker } from "./connects-sync.worker";
import { UpworkConnectsSyncService } from "./connects-sync.service";

/**
 * Connects usage domain — self-contained module (Part: Upwork API
 * integration — modular architecture pass, 2026-10-22): read-side service
 * (DB-only, no live Upwork calls), sync Queue/Worker/Service (owns talking
 * to Upwork on a 6h schedule via UpworkApiConnectionService.getValidAccessToken
 * — real token-refresh, not a direct decrypt, see connects-sync.service.ts's
 * own docblock for the bug that fixed), and the controller, all in one
 * place. Depends on UpworkSharedModule (GraphQL client) and
 * UpworkConnectionModule (token refresh) — no dependency on any other
 * domain module, so this can be developed/tested/removed independently.
 */
@Module({
  imports: [UpworkSharedModule, UpworkConnectionModule],
  controllers: [UpworkConnectsUsageController],
  providers: [UpworkConnectsUsageService, UpworkConnectsSyncQueue, UpworkConnectsSyncWorker, UpworkConnectsSyncService],
  exports: [UpworkConnectsUsageService],
})
export class UpworkConnectsUsageModule {}
