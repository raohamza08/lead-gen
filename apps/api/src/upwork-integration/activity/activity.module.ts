import { Module } from "@nestjs/common";
import { UpworkConnectionModule } from "../connection/connection.module";
import { UpworkActivityController } from "./activity.controller";
import { UpworkActivityService } from "./activity.service";

/** Activity domain (spec Module R) — currently BLOCKED (Part: Upwork API
 *  integration — Activity domain, 2026-10-23), see activity.service.ts's
 *  own docblock. */
@Module({
  imports: [UpworkConnectionModule],
  controllers: [UpworkActivityController],
  providers: [UpworkActivityService],
})
export class UpworkActivityModule {}
