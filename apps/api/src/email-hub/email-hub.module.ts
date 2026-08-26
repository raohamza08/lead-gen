import { Module } from "@nestjs/common";
import { EmailModule } from "../email/email.module";
import { LeadsModule } from "../leads/leads.module";
import { ImapReaderProvider } from "./readers/imap-reader.provider";
import { EmailHubSyncQueue } from "./email-hub-sync.queue";
import { EmailHubSyncWorker } from "./email-hub-sync.worker";
import { EmailHubService } from "./email-hub.service";
import { EmailHubController } from "./email-hub.controller";
import { EmailLeadClassifierService } from "./email-lead-classifier.service";

@Module({
  imports: [EmailModule, LeadsModule],
  controllers: [EmailHubController],
  providers: [
    ImapReaderProvider,
    EmailHubSyncQueue,
    EmailHubSyncWorker,
    EmailHubService,
    EmailLeadClassifierService,
  ],
})
export class EmailHubModule {}
