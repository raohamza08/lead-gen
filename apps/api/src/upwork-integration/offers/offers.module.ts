import { Module } from "@nestjs/common";
import { UpworkSharedModule } from "../shared/upwork-shared.module";
import { UpworkConnectionModule } from "../connection/connection.module";
import { UpworkOffersController } from "./offers.controller";
import { UpworkOffersService } from "./offers.service";

/** Offers domain (spec Module J) — currently BLOCKED by a reproducible
 *  Upwork backend error (Part: Upwork API integration — Offers domain,
 *  2026-10-23), see offers.service.ts's own docblock. */
@Module({
  imports: [UpworkSharedModule, UpworkConnectionModule],
  controllers: [UpworkOffersController],
  providers: [UpworkOffersService],
})
export class UpworkOffersModule {}
