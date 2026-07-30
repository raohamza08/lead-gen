import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { GmailProvider } from "./providers/gmail.provider";
import { SmtpProvider } from "./providers/smtp.provider";
import { OrganizationService } from "../organization/organization.service";

/**
 * Internal, non-outreach sends (new-user credentials, password resets later)
 * that must never go through EmailProviderService.sendForLead: there is no
 * Lead on the other end, so the suppression list / unsubscribe-link / daily-
 * limit gates built for prospect outreach don't apply and would just block
 * a send that has nothing to do with a sales sequence.
 */
@Injectable()
export class TransactionalEmailService {
  private readonly logger = new Logger(TransactionalEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gmail: GmailProvider,
    private readonly smtp: SmtpProvider,
    private readonly organization: OrganizationService,
  ) {}

  /** Returns false rather than throwing on failure — a team member's account
   *  should still get created even if the welcome email can't be sent right
   *  now; the caller surfaces that to the admin instead of losing the account. */
  async send(orgId: string, toAddress: string, subject: string, bodyHtml: string): Promise<boolean> {
    const account = await this.prisma.emailAccount.findFirst({
      where: { orgId, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
    });
    if (!account) {
      this.logger.warn(`No active mailbox for org ${orgId} — could not send "${subject}" to ${toAddress}`);
      return false;
    }

    const branding = await this.organization.getBranding(orgId);
    const provider = account.provider === "GMAIL" ? this.gmail : this.smtp;

    try {
      await provider.send(account, {
        fromAddress: account.address,
        fromName: branding.emailSenderName,
        toAddress,
        subject,
        bodyHtml,
      });
      return true;
    } catch (err) {
      this.logger.warn(`Failed to send "${subject}" to ${toAddress}: ${(err as Error).message}`);
      return false;
    }
  }
}
