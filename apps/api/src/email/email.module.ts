import { Module } from "@nestjs/common";
import { GmailProvider } from "./providers/gmail.provider";
import { SmtpProvider } from "./providers/smtp.provider";
import { EmailProviderService } from "./email-provider.service";
import { EmailSendWorker } from "./email-send.worker";
import { EmailAccountsService } from "./email-accounts.service";
import { EmailAccountsController } from "./email-accounts.controller";

@Module({
  controllers: [EmailAccountsController],
  providers: [GmailProvider, SmtpProvider, EmailProviderService, EmailSendWorker, EmailAccountsService],
  exports: [EmailProviderService, GmailProvider],
})
export class EmailModule {}
