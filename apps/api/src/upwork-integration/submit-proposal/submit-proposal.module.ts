import { Module } from "@nestjs/common";
import { UpworkSharedModule } from "../shared/upwork-shared.module";
import { UpworkConnectionModule } from "../connection/connection.module";
import { UpworkSubmitProposalController } from "./submit-proposal.controller";
import { UpworkSubmitProposalService } from "./submit-proposal.service";

/** Submit Proposals to Jobs domain (spec Module Q) — LIVE, real mutation
 *  (Part: Upwork API integration — Submit Proposals domain, 2026-10-23).
 *  Self-contained, same shape as every other live domain module. */
@Module({
  imports: [UpworkSharedModule, UpworkConnectionModule],
  controllers: [UpworkSubmitProposalController],
  providers: [UpworkSubmitProposalService],
})
export class UpworkSubmitProposalModule {}
