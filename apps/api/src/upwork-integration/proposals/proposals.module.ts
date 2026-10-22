import { Module } from "@nestjs/common";
import { UpworkSharedModule } from "../shared/upwork-shared.module";
import { UpworkProposalsController } from "./proposals.controller";
import { UpworkBiddingService } from "./proposals.service";
import { UpworkProposalsSyncQueue } from "./proposals-sync.queue";
import { UpworkProposalsSyncWorker } from "./proposals-sync.worker";
import { UpworkProposalsSyncService } from "./proposals-sync.service";

/** Bidding/proposals domain — self-contained module, same shape as
 *  UpworkConnectsUsageModule (Part: Upwork API integration — modular
 *  architecture pass, 2026-10-22). Only depends on UpworkSharedModule. */
@Module({
  imports: [UpworkSharedModule],
  controllers: [UpworkProposalsController],
  providers: [UpworkBiddingService, UpworkProposalsSyncQueue, UpworkProposalsSyncWorker, UpworkProposalsSyncService],
})
export class UpworkProposalsModule {}
