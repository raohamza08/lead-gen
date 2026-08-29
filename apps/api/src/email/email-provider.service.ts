import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { GmailProvider } from "./providers/gmail.provider";
import { SmtpProvider } from "./providers/smtp.provider";
import { EmailProvider } from "./email-provider.interface";
import { OrganizationService } from "../organization/organization.service";
import { apiPublicUrl } from "../common/api-url";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { NotificationsService } from "../notifications/notifications.service";

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
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Sends a persisted, already-approved EmailMessage right now, synchronously
   * — no queue, no background retry. The user explicitly wants send outcome
   * known immediately: previously a send was a BullMQ job that could sit
   * showing "queued" through up to 3 retries with exponential backoff before
   * anyone knew it had failed, and a manual resend re-entered the same opaque
   * queue with no visibility into when (or whether) it would actually fire.
   * One direct attempt, one definite outcome, written to the row and pushed
   * over the realtime socket before this returns.
   */
  async sendMessageNow(emailMessageId: string): Promise<{ status: "SENT" | "FAILED"; failureReason?: string }> {
    const message = await this.prisma.emailMessage.findUniqueOrThrow({ where: { id: emailMessageId } });

    try {
      const { accountId, providerMessageId } = await this.sendForLead(message.leadId, message.subject, message.bodyHtml, message.id);

      await this.prisma.emailMessage.update({
        where: { id: emailMessageId },
        data: { status: "SENT", sentAt: new Date(), accountId },
      });
      await this.prisma.emailEvent.create({
        data: { messageId: emailMessageId, eventType: "SENT", meta: { providerMessageId } },
      });
      const lead = await this.prisma.lead.update({
        where: { id: message.leadId },
        data: { lastActivityAt: new Date() },
        select: { orgId: true },
      });
      this.realtime.emitToOrg(lead.orgId, "email.sent", { leadId: message.leadId, emailMessageId });
      return { status: "SENT" };
    } catch (err) {
      const failureReason = (err as Error).message;
      if (err instanceof ComplianceGateError) {
        this.logger.warn(`Compliance gate blocked send for message ${emailMessageId}: ${failureReason}`);
      } else {
        this.logger.error(`Send failed for message ${emailMessageId}: ${failureReason}`);
      }

      await this.prisma.emailMessage.update({
        where: { id: emailMessageId },
        data: { status: "FAILED", failureReason },
      });
      const lead = await this.prisma.lead.findUnique({ where: { id: message.leadId }, select: { orgId: true } });
      if (lead) {
        this.realtime.emitToOrg(lead.orgId, "email.failed", { leadId: message.leadId, emailMessageId });
        // ComplianceGateError is an expected, self-explanatory state visible
        // right on the message row (no mailbox configured, recipient
        // suppressed, etc.) -- a provider-side failure (SMTP/API error) is
        // the one worth interrupting someone for.
        if (!(err instanceof ComplianceGateError)) {
          await this.notifications.notify(lead.orgId, {
            type: "EMAIL_SEND_FAILED",
            severity: "ERROR",
            message: `Email send failed: ${failureReason}`,
            leadId: message.leadId,
          });
        }
      }
      return { status: "FAILED", failureReason };
    }
  }

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
      // An unset address renders as empty, never as placeholder/warning
      // text — a literal "[set one in Settings]"-style string was sent to
      // real prospects before this fix, which is far worse than a blank
      // signature line. Missing the address is a compliance gap for the
      // org to fix in Settings, not something to expose to the recipient.
      // The " · " separator before "Unsubscribe" (see append_signature in
      // drafting.py) is supplied here, not hardcoded in the template, so an
      // empty address doesn't leave a dangling "· Unsubscribe" behind.
      .replace(/\{\{org\.postal_address\}\}/g, branding.postalAddress ? `${branding.postalAddress} · ` : "")
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

    // One grouped query instead of one count() per account — this ran in a
    // loop before, paying a full DB round trip per mailbox in sequence
    // (~400ms each against this DB's region) on every single outbound send.
    const sentCounts = await this.prisma.emailMessage.groupBy({
      by: ["accountId"],
      where: { accountId: { in: accounts.map((a) => a.id) }, sentAt: { gte: since } },
      _count: { _all: true },
    });
    const sentByAccount = new Map(sentCounts.map((c) => [c.accountId, c._count._all]));

    for (const account of accounts) {
      const sentToday = sentByAccount.get(account.id) ?? 0;
      if (sentToday < account.dailyLimit) {
        return account;
      }
    }
    return null;
  }
}
