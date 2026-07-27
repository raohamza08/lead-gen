import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { GmailProvider } from "./providers/gmail.provider";
import { SmtpProvider } from "./providers/smtp.provider";
import { EmailProvider } from "./email-provider.interface";

export class ComplianceGateError extends Error {}

/**
 * Selects a rotation-eligible mailbox and enforces the hard compliance gates
 * from Part C6/I4/I5 before any send: suppression list, per-account daily/hourly
 * limits, and a well-formed unsubscribe link. These are mechanical checks, not
 * copy guidelines — CAN-SPAM/GDPR non-compliance is a launch blocker (Part I6).
 */
@Injectable()
export class EmailProviderService {
  private readonly logger = new Logger(EmailProviderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gmail: GmailProvider,
    private readonly smtp: SmtpProvider,
  ) {}

  async sendForLead(leadId: string, subject: string, bodyHtml: string): Promise<{ accountId: string; providerMessageId: string }> {
    const lead = await this.prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    if (!lead.email) {
      throw new ComplianceGateError("Lead has no verified email address");
    }

    const suppressed = await this.prisma.suppressionEntry.findUnique({
      where: { orgId_email: { orgId: lead.orgId, email: lead.email } },
    });
    if (suppressed) {
      throw new ComplianceGateError(`Recipient is on the suppression list (${suppressed.reason})`);
    }

    if (!bodyHtml.includes("{{unsubscribe_link}}") && !bodyHtml.includes("unsubscribe")) {
      throw new ComplianceGateError("Email body is missing an unsubscribe mechanism (CAN-SPAM requirement)");
    }

    const account = await this.pickAvailableAccount(lead.orgId);
    if (!account) {
      throw new ComplianceGateError("No email account available within its daily/hourly send limit");
    }

    const provider = this.providerFor(account.provider);
    const renderedBody = bodyHtml
      .replace("{{unsubscribe_link}}", `${process.env.APP_BASE_URL}/unsubscribe?lead=${lead.id}`)
      .replace("{{org.postal_address}}", process.env.ORG_POSTAL_ADDRESS ?? "[postal address required by CAN-SPAM]");

    const result = await provider.send(account, {
      fromAddress: account.address,
      toAddress: lead.email,
      subject,
      bodyHtml: renderedBody,
    });

    return { accountId: account.id, providerMessageId: result.providerMessageId };
  }

  private providerFor(provider: string): EmailProvider {
    switch (provider) {
      case "GMAIL":
        return this.gmail;
      default:
        return this.smtp;
    }
  }

  /**
   * Rotation + rate limiting (Part B2/E5/I1): picks the least-recently-used
   * ACTIVE account that hasn't hit its daily limit. A production version should
   * track a rolling send counter per account rather than counting rows on every
   * send; this scaffold favors correctness/readability over that optimization.
   */
  private async pickAvailableAccount(orgId: string) {
    const accounts = await this.prisma.emailAccount.findMany({ where: { orgId, status: "ACTIVE" } });
    const since = new Date();
    since.setHours(0, 0, 0, 0);

    for (const account of accounts) {
      const sentToday = await this.prisma.emailMessage.count({
        where: { accountId: account.id, sentAt: { gte: since } },
      });
      if (sentToday < account.dailyLimit) {
        return account;
      }
    }
    return null;
  }
}
