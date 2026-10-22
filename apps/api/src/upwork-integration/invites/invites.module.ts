import { Module } from "@nestjs/common";
import { UpworkSharedModule } from "../shared/upwork-shared.module";
import { UpworkConnectionModule } from "../connection/connection.module";
import { UpworkInvitesController } from "./invites.controller";
import { UpworkInvitesService } from "./invites.service";
import { UpworkInvitesSyncQueue } from "./invites-sync.queue";
import { UpworkInvitesSyncWorker } from "./invites-sync.worker";
import { UpworkInvitesSyncService } from "./invites-sync.service";

/** Invites domain — LIVE, self-contained module (Part: Upwork API
 *  integration — Invites domain, 2026-10-22), same shape as
 *  UpworkProposalsModule/UpworkConnectsUsageModule. Deliberately its own
 *  module/table/sync pipeline, separate from UpworkProposalsModule — see
 *  invites.service.ts's own docblock for why. */
@Module({
  imports: [UpworkSharedModule, UpworkConnectionModule],
  controllers: [UpworkInvitesController],
  providers: [UpworkInvitesService, UpworkInvitesSyncQueue, UpworkInvitesSyncWorker, UpworkInvitesSyncService],
})
export class UpworkInvitesModule {}
