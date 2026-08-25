import { Injectable, Logger } from "@nestjs/common";
import { EmailAccount } from "@prisma/client";
import nodemailer from "nodemailer";
import { EncryptionService } from "../../common/crypto/encryption.service";
import { EmailProvider, formatFrom, OutboundEmail } from "../email-provider.interface";

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

  constructor(private readonly encryption: EncryptionService) {}

  async send(account: EmailAccount, email: OutboundEmail): Promise<{ providerMessageId: string }> {
    if (!account.smtpUsername || !account.smtpPassword) {
      // Never fake a success here — a caller that gets a providerMessageId
      // back has no way to know the message never actually left the server.
      // Confirmed live: this exact silent stub is what let an unconfigured
      // mailbox record a lead's whole sequence as SENT when nothing was ever
      // delivered. Throwing lets EmailSendWorker mark the message FAILED
      // with this real reason instead.
      throw new Error(`${account.address} has no SMTP username/password configured — cannot send`);
    }

    const defaults = PROVIDER_DEFAULTS[account.provider] ?? { host: "", port: 587 };
    const host = account.smtpHost ?? defaults.host;
    const port = account.smtpPort ?? defaults.port;
    // Encrypted at rest since the Email Hub migration; tolerates a
    // still-plaintext legacy row (looksEncrypted distinguishes the two) so
    // no separate backfill blocks this from shipping.
    const password = this.encryption.looksEncrypted(account.smtpPassword)
      ? this.encryption.decrypt(account.smtpPassword)
      : account.smtpPassword;

    const transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user: account.smtpUsername, pass: password },
    });

    const info = await transport.sendMail({
      from: formatFrom(email.fromAddress, email.fromName),
      to: email.toAddress,
      subject: email.subject,
      html: email.bodyHtml,
      headers: email.headers,
    });

    return { providerMessageId: info.messageId };
  }
}
