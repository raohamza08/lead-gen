import { Module } from "@nestjs/common";
import { UpworkSharedModule } from "../shared/upwork-shared.module";
import { UpworkConnectionModule } from "../connection/connection.module";
import { UpworkPublicUserController } from "./public-user.controller";
import { UpworkPublicUserService } from "./public-user.service";

/** Public User Details domain (spec Module O) — LIVE (Part: Upwork API
 *  integration — Public User Details domain, 2026-10-23). Self-contained,
 *  same shape as every other live domain module. */
@Module({
  imports: [UpworkSharedModule, UpworkConnectionModule],
  controllers: [UpworkPublicUserController],
  providers: [UpworkPublicUserService],
})
export class UpworkPublicUserModule {}
