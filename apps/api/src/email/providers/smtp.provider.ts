import { Injectable, Logger } from "@nestjs/common";
import { EmailAccount } from "@prisma/client";
import nodemailer from "nodemailer";
import { EmailProvider, OutboundEmail } from "../email-provider.interface";

const PROVIDER_DEFAULTS: Record<string, { host: string; port: number }> = {
  MICROSOFT_365: { host: "smtp.office365.com", port: 587 },
};

/**
 * Generic SMTP AUTH sender (Part B2) — covers both the MICROSOFT_365 and
 * plain SMTP EmailAccount providers, since Microsoft 365 mailboxes support
 * SMTP AUTH directly without a full Graph OAuth app registration. Falls back
 * to logging intent when the account has no SMTP credentials configured yet.
 */
@Injectable()
export class SmtpProvider implements EmailProvider {
  private readonly logger = new Logger(SmtpProvider.name);

  async send(account: EmailAccount, email: OutboundEmail): Promise<{ providerMessageId: string }> {
    if (!account.smtpUsername || !account.smtpPassword) {
      this.logger.log(`[stub] would send via SMTP: to=${email.toAddress} subject="${email.subject}"`);
      return { providerMessageId: `stub-smtp-${Date.now()}` };
    }

    const defaults = PROVIDER_DEFAULTS[account.provider] ?? { host: "", port: 587 };
    const host = account.smtpHost ?? defaults.host;
    const port = account.smtpPort ?? defaults.port;

    const transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user: account.smtpUsername, pass: account.smtpPassword },
    });

    const info = await transport.sendMail({
      from: email.fromAddress,
      to: email.toAddress,
      subject: email.subject,
      html: email.bodyHtml,
      headers: email.headers,
    });

    return { providerMessageId: info.messageId };
  }
}
