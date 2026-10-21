import { Module } from "@nestjs/common";
import { UpworkController } from "./upwork.controller";
import { UpworkService } from "./upwork.service";
import { UpworkRequestController } from "./upwork-request.controller";
import { UpworkRequestService } from "./upwork-request.service";
import { UpworkProposalAccessGuard } from "./upwork-proposal-access.guard";
import { UpworkFollowUpReminderQueue } from "./upwork-follow-up-reminder.queue";
import { UpworkFollowUpReminderWorker } from "./upwork-follow-up-reminder.worker";
import { UpworkClickupSyncService } from "./upwork-clickup-sync.service";
import { SyncModule } from "../sync/sync.module";

@Module({
  imports: [SyncModule],
  controllers: [UpworkController, UpworkRequestController],
  providers: [
    UpworkService,
    UpworkRequestService,
    UpworkProposalAccessGuard,
    UpworkFollowUpReminderQueue,
    UpworkFollowUpReminderWorker,
    UpworkClickupSyncService,
  ],
  // UpworkService exported (Part: global search, 2026-10-21) so
  // SearchModule/AiAssistantModule can reuse its existing findAll search
  // query instead of duplicating it.
  exports: [UpworkService],
})
export class UpworkModule {}
