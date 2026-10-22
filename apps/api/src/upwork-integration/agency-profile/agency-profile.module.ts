import { Module } from "@nestjs/common";
import { UpworkConnectionModule } from "../connection/connection.module";
import { UpworkAgencyProfileController } from "./agency-profile.controller";
import { UpworkAgencyProfileService } from "./agency-profile.service";

/** Agency profile domain — stub module (Part: Upwork API integration —
 *  modular architecture pass, 2026-10-22). Depends on UpworkConnectionModule
 *  for UpworkApiConnectionService (the stub only validates a connection
 *  exists before throwing). */
@Module({
  imports: [UpworkConnectionModule],
  controllers: [UpworkAgencyProfileController],
  providers: [UpworkAgencyProfileService],
})
export class UpworkAgencyProfileModule {}
