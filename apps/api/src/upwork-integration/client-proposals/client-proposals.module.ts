import { Module } from "@nestjs/common";
import { UpworkConnectionModule } from "../connection/connection.module";
import { UpworkClientProposalsController } from "./client-proposals.controller";
import { UpworkClientProposalsService } from "./client-proposals.service";

/** Client Proposals domain (spec Module P) — NOT APPLICABLE to this
 *  account's role (Part: Upwork API integration — Client Proposals
 *  domain, 2026-10-23), see client-proposals.service.ts's own docblock. */
@Module({
  imports: [UpworkConnectionModule],
  controllers: [UpworkClientProposalsController],
  providers: [UpworkClientProposalsService],
})
export class UpworkClientProposalsModule {}
