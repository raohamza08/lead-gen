import { Module } from "@nestjs/common";
import { UpworkSharedModule } from "../shared/upwork-shared.module";
import { UpworkConnectionModule } from "../connection/connection.module";
import { UpworkTimesheetsController } from "./timesheets.controller";
import { UpworkTimesheetsService } from "./timesheets.service";

/** Timesheets domain (spec Module E) — currently BLOCKED by a team-level
 *  Upwork permission (Part: Upwork API integration — Timesheets domain,
 *  2026-10-23), see timesheets.service.ts's own docblock. */
@Module({
  imports: [UpworkSharedModule, UpworkConnectionModule],
  controllers: [UpworkTimesheetsController],
  providers: [UpworkTimesheetsService],
})
export class UpworkTimesheetsModule {}
