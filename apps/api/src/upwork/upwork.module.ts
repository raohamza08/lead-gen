import { Module } from "@nestjs/common";
import { UpworkController } from "./upwork.controller";
import { UpworkService } from "./upwork.service";
import { UpworkRequestController } from "./upwork-request.controller";
import { UpworkRequestService } from "./upwork-request.service";
import { UpworkFollowUpReminderQueue } from "./upwork-follow-up-reminder.queue";
import { UpworkFollowUpReminderWorker } from "./upwork-follow-up-reminder.worker";

@Module({
  controllers: [UpworkController, UpworkRequestController],
  providers: [UpworkService, UpworkRequestService, UpworkFollowUpReminderQueue, UpworkFollowUpReminderWorker],
})
export class UpworkModule {}
