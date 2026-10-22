import { Module } from "@nestjs/common";
import { UpworkConnectionModule } from "../connection/connection.module";
import { UpworkReportingController } from "./reporting.controller";
import { UpworkReportingService } from "./reporting.service";

/** Reporting domain — stub module (Part: Upwork API integration — modular
 *  architecture pass, 2026-10-22). */
@Module({
  imports: [UpworkConnectionModule],
  controllers: [UpworkReportingController],
  providers: [UpworkReportingService],
})
export class UpworkReportingModule {}
