import { Module } from "@nestjs/common";
import { UpworkSharedModule } from "../shared/upwork-shared.module";
import { UpworkConnectionModule } from "../connection/connection.module";
import { UpworkFreelancerProfilesController } from "./freelancer-profiles.controller";
import { UpworkFreelancerProfilesService } from "./freelancer-profiles.service";
import { UpworkFreelancerProfilesSyncQueue } from "./freelancer-profiles-sync.queue";
import { UpworkFreelancerProfilesSyncWorker } from "./freelancer-profiles-sync.worker";
import { UpworkFreelancerProfilesSyncService } from "./freelancer-profiles-sync.service";

/** Freelancer Profiles domain (spec Module H) — LIVE (Part: Upwork API
 *  integration — Freelancer Profiles domain, 2026-10-23). Self-contained,
 *  same shape as every other live domain module. */
@Module({
  imports: [UpworkSharedModule, UpworkConnectionModule],
  controllers: [UpworkFreelancerProfilesController],
  providers: [
    UpworkFreelancerProfilesService,
    UpworkFreelancerProfilesSyncQueue,
    UpworkFreelancerProfilesSyncWorker,
    UpworkFreelancerProfilesSyncService,
  ],
})
export class UpworkFreelancerProfilesModule {}
