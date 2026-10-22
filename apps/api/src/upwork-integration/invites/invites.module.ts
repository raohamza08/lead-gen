import { Module } from "@nestjs/common";
import { UpworkConnectionModule } from "../connection/connection.module";
import { UpworkInvitesController } from "./invites.controller";
import { UpworkInvitesService } from "./invites.service";

/** Invite tracking domain — stub module (Part: Upwork API integration —
 *  modular architecture pass, 2026-10-22). */
@Module({
  imports: [UpworkConnectionModule],
  controllers: [UpworkInvitesController],
  providers: [UpworkInvitesService],
})
export class UpworkInvitesModule {}
