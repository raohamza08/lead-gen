import { Module } from "@nestjs/common";
import { UpworkSharedModule } from "../shared/upwork-shared.module";
import { UpworkConnectionModule } from "../connection/connection.module";
import { UpworkContractProposalsController } from "./contract-proposals.controller";
import { UpworkContractProposalsService } from "./contract-proposals.service";

/** Contract Proposals domain (spec Module L) — LIVE (Part: Upwork API
 *  integration — Contract Proposals domain, 2026-10-23). Self-contained,
 *  same shape as every other live domain module. */
@Module({
  imports: [UpworkSharedModule, UpworkConnectionModule],
  controllers: [UpworkContractProposalsController],
  providers: [UpworkContractProposalsService],
})
export class UpworkContractProposalsModule {}
