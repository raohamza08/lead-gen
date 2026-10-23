import { Module } from "@nestjs/common";
import { UpworkSharedModule } from "../shared/upwork-shared.module";
import { UpworkConnectionModule } from "../connection/connection.module";
import { UpworkAgencyToolsController } from "./agency-tools.controller";
import { UpworkAgencyToolsService } from "./agency-tools.service";

/** See UpworkAgencyToolsService's own docblock for why these four
 *  capabilities are grouped into one module instead of four. */
@Module({
  imports: [UpworkSharedModule, UpworkConnectionModule],
  controllers: [UpworkAgencyToolsController],
  providers: [UpworkAgencyToolsService],
})
export class UpworkAgencyToolsModule {}
