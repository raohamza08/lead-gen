import { Module } from "@nestjs/common";
import { UpworkSharedModule } from "../shared/upwork-shared.module";
import { UpworkConnectionModule } from "../connection/connection.module";
import { UpworkTransactionsController } from "./transactions.controller";
import { UpworkTransactionsService } from "./transactions.service";
import { UpworkTransactionsSyncQueue } from "./transactions-sync.queue";
import { UpworkTransactionsSyncWorker } from "./transactions-sync.worker";
import { UpworkTransactionsSyncService } from "./transactions-sync.service";

/** Transactions & Financial History domain (spec Module B) — LIVE
 *  (Part: Upwork API integration — Transactions domain, 2026-10-23).
 *  Self-contained, same shape as every other live domain module. */
@Module({
  imports: [UpworkSharedModule, UpworkConnectionModule],
  controllers: [UpworkTransactionsController],
  providers: [UpworkTransactionsService, UpworkTransactionsSyncQueue, UpworkTransactionsSyncWorker, UpworkTransactionsSyncService],
  exports: [UpworkTransactionsService],
})
export class UpworkTransactionsModule {}
