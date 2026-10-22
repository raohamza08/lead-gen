import { Module } from "@nestjs/common";
import { UpworkConnectionModule } from "../connection/connection.module";
import { UpworkJobDiscoveryController } from "./job-discovery.controller";
import { UpworkJobDiscoveryService } from "./job-discovery.service";

/** Job discovery domain — stub module (Part: Upwork API integration —
 *  modular architecture pass, 2026-10-22). */
@Module({
  imports: [UpworkConnectionModule],
  controllers: [UpworkJobDiscoveryController],
  providers: [UpworkJobDiscoveryService],
})
export class UpworkJobDiscoveryModule {}
