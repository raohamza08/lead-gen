import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { GmailProvider } from "./providers/gmail.provider";
import { SmtpProvider } from "./providers/smtp.provider";
import { EmailProvider } from "./email-provider.interface";
import { OrganizationService } from "../organization/organization.service";
import { apiPublicUrl } from "../common/api-url";

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
    private readonly organization: OrganizationService,
  ) {}

  /**
   * `messageId` is optional only because a handful of call sites (the test
   * send in EmailAccountsService, notably) send without a persisted
   * EmailMessage row to attach an open-tracking pixel to — every real
   * outreach send has one, and skipping the pixel there just means an
   * operator's own test open never appears in analytics, which is correct.
   */
  async sendForLead(
    leadId: string,
    subject: string,
    bodyHtml: string,
    messageId?: string,
  ): Promise<{ accountId: string; providerMessageId: string }> {
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

    const branding = await this.organization.getBranding(lead.orgId);
    const provider = this.providerFor(account.provider);
    const apiRoot = apiPublicUrl();
    let renderedBody = bodyHtml
      .replace(/\{\{unsubscribe_link\}\}/g, `${apiRoot}/unsubscribe?lead=${lead.id}`)
      // `|| fallback`, not `?? fallback`: an org that has never set one gets
      // an empty string back from getBranding, not null/undefined — `??`
      // only catches those two, so it let an empty address through as an
      // empty string and every sent email quietly read "· Unsubscribe" with
      // nothing before the bullet. Confirmed live in this org's own sent
      // mail before this fix.
      .replace(/\{\{org\.postal_address\}\}/g, branding.postalAddress || "[postal address required by CAN-SPAM — set one in Settings]")
      .replace(/\{\{org\.name\}\}/g, branding.emailOrgName)
      .replace(/\{\{sender\.name\}\}/g, branding.emailSenderName);

    if (messageId) {
      renderedBody += `<img src="${apiRoot}/track/open/${messageId}.png" width="1" height="1" alt="" style="display:none" />`;
    }

    const result = await provider.send(account, {
      fromAddress: account.address,
      // A per-mailbox display name (Settings > Email accounts) wins over the
      // org-wide sender name — an org with several mailboxes may want each to
      // show a different name in the recipient's inbox.
      fromName: account.displayName || branding.emailSenderName,
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
    // sendingEnabled is a separate, explicit opt-in from status — a mailbox
    // being ACTIVE (e.g. for Email Hub reading) never used to be enough to
    // keep it out of real outreach rotation on its own. See EmailAccount.
    // sendingEnabled's schema comment for the live incident that caused this.
    const accounts = await this.prisma.emailAccount.findMany({ where: { orgId, status: "ACTIVE", sendingEnabled: true } });
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
