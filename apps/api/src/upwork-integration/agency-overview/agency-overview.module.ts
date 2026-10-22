import { Module } from "@nestjs/common";
import { UpworkAgencyProfileModule } from "../agency-profile/agency-profile.module";
import { UpworkConnectsUsageModule } from "../connects-usage/connects-usage.module";
import { UpworkProposalsModule } from "../proposals/proposals.module";
import { UpworkInvitesModule } from "../invites/invites.module";
import { UpworkTransactionsModule } from "../transactions/transactions.module";
import { UpworkWorkHistoryModule } from "../work-history/work-history.module";
import { UpworkFreelancerProfilesModule } from "../freelancer-profiles/freelancer-profiles.module";
import { UpworkRoomsModule } from "../rooms/rooms.module";
import { UpworkAgencyOverviewController } from "./agency-overview.controller";
import { UpworkAgencyOverviewService } from "./agency-overview.service";

/** Agency Overview domain (spec Module A) — LIVE (Part: Upwork API
 *  integration — Agency Overview domain, 2026-10-23). The one module
 *  that deliberately depends on many others — it's a pure composition
 *  layer, adds no new Upwork API calls of its own. */
@Module({
  imports: [
    UpworkAgencyProfileModule,
    UpworkConnectsUsageModule,
    UpworkProposalsModule,
    UpworkInvitesModule,
    UpworkTransactionsModule,
    UpworkWorkHistoryModule,
    UpworkFreelancerProfilesModule,
    UpworkRoomsModule,
  ],
  controllers: [UpworkAgencyOverviewController],
  providers: [UpworkAgencyOverviewService],
})
export class UpworkAgencyOverviewModule {}
