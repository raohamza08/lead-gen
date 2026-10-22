import { Module } from "@nestjs/common";
import { UpworkSharedModule } from "../shared/upwork-shared.module";
import { UpworkConnectionModule } from "../connection/connection.module";
import { UpworkMarketplaceJobsController } from "./marketplace-jobs.controller";
import { UpworkMarketplaceJobsService } from "./marketplace-jobs.service";

/** Marketplace Job Postings + Job Details domain (spec Modules G + S) —
 *  LIVE (Part: Upwork API integration — Marketplace Jobs domain,
 *  2026-10-23). Self-contained, same shape as every other live domain
 *  module. */
@Module({
  imports: [UpworkSharedModule, UpworkConnectionModule],
  controllers: [UpworkMarketplaceJobsController],
  providers: [UpworkMarketplaceJobsService],
})
export class UpworkMarketplaceJobsModule {}
