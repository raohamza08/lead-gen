import { Module } from "@nestjs/common";
import { EmailModule } from "../email/email.module";
import { LeadsModule } from "../leads/leads.module";
import { SequencerModule } from "../sequencer/sequencer.module";
import { ImapReaderProvider } from "./readers/imap-reader.provider";
import { EmailHubSyncQueue } from "./email-hub-sync.queue";
import { EmailHubSyncWorker } from "./email-hub-sync.worker";
import { EmailHubService } from "./email-hub.service";
import { EmailHubController } from "./email-hub.controller";
import { EmailLeadClassifierService } from "./email-lead-classifier.service";
import { EmailAccountResumeQueue } from "./email-account-resume.queue";
import { EmailAccountResumeWorker } from "./email-account-resume.worker";

@Module({
  imports: [EmailModule, LeadsModule, SequencerModule],
  controllers: [EmailHubController],
  providers: [
    ImapReaderProvider,
    EmailHubSyncQueue,
    EmailHubSyncWorker,
    EmailHubService,
    EmailLeadClassifierService,
    EmailAccountResumeQueue,
    EmailAccountResumeWorker,
  ],
})
export class EmailHubModule {}
