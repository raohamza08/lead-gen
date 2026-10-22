import { Module } from "@nestjs/common";
import { UpworkSharedModule } from "../shared/upwork-shared.module";
import { UpworkConnectionModule } from "../connection/connection.module";
import { UpworkCommonEntitiesController } from "./common-entities.controller";
import { UpworkCommonEntitiesService } from "./common-entities.service";

/** Common Entities domain (spec Module M) — LIVE (Part: Upwork API
 *  integration — Common Entities domain, 2026-10-23). Self-contained,
 *  same shape as every other live domain module. */
@Module({
  imports: [UpworkSharedModule, UpworkConnectionModule],
  controllers: [UpworkCommonEntitiesController],
  providers: [UpworkCommonEntitiesService],
})
export class UpworkCommonEntitiesModule {}
