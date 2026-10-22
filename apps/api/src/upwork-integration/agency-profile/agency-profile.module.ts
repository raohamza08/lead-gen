import { Module } from "@nestjs/common";
import { UpworkSharedModule } from "../shared/upwork-shared.module";
import { UpworkConnectionModule } from "../connection/connection.module";
import { UpworkAgencyProfileController } from "./agency-profile.controller";
import { UpworkAgencyProfileService } from "./agency-profile.service";

/** Organization & Agency domain (spec Module C) — LIVE (Part: Upwork API
 *  integration — Organization domain, 2026-10-23). Depends on
 *  UpworkSharedModule (GraphQL client) and UpworkConnectionModule (token
 *  refresh), same shape as every other live domain module. */
@Module({
  imports: [UpworkSharedModule, UpworkConnectionModule],
  controllers: [UpworkAgencyProfileController],
  providers: [UpworkAgencyProfileService],
})
export class UpworkAgencyProfileModule {}
