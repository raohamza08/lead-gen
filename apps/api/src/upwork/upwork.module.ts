import { Module } from "@nestjs/common";
import { UpworkController } from "./upwork.controller";
import { UpworkService } from "./upwork.service";
import { UpworkFollowUpReminderQueue } from "./upwork-follow-up-reminder.queue";
import { UpworkFollowUpReminderWorker } from "./upwork-follow-up-reminder.worker";

@Module({
  controllers: [UpworkController],
  providers: [UpworkService, UpworkFollowUpReminderQueue, UpworkFollowUpReminderWorker],
})
export class UpworkModule {}
