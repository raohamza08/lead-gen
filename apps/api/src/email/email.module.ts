import { Module } from "@nestjs/common";
import { GmailProvider } from "./providers/gmail.provider";
import { SmtpProvider } from "./providers/smtp.provider";
import { EmailProviderService } from "./email-provider.service";
import { EmailAccountsService } from "./email-accounts.service";
import { EmailAccountsController } from "./email-accounts.controller";
import { TransactionalEmailService } from "./transactional-email.service";
import { OrganizationModule } from "../organization/organization.module";

@Module({
  imports: [OrganizationModule],
  controllers: [EmailAccountsController],
  providers: [
    GmailProvider,
    SmtpProvider,
    EmailProviderService,
    EmailAccountsService,
    TransactionalEmailService,
  ],
  exports: [EmailProviderService, GmailProvider, TransactionalEmailService],
})
export class EmailModule {}
