import { Injectable, Logger } from "@nestjs/common";
import { EmailAccount } from "@prisma/client";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { EncryptionService } from "../../common/crypto/encryption.service";
import { createImapClient, findSentMailbox } from "../../email-hub/readers/imap-connection.util";
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
      // delivered. Throwing lets EmailProviderService.sendMessageNow mark the
      // message FAILED with this real reason instead.
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

    // Built once, up front, rather than letting nodemailer assemble the MIME
    // message internally from structured fields (Part: Email Hub "sent mail
    // disappears," 2026-09-02) — SMTP only transmits a message, it never
    // saves a copy anywhere (unlike the Gmail API, which auto-files into
    // Sent as part of sending). Confirmed live: a message sent through a
    // generic SMTP/Microsoft 365 account never showed up anywhere in Email
    // Hub, because nothing ever told the mailbox to keep a copy. Building
    // the raw MIME bytes here means the exact same message can be (a) handed
    // to nodemailer via `raw` for transmission and (b) IMAP-appended to the
    // account's own Sent folder below — byte-identical, not reconstructed
    // twice and risking drift.
    const raw = await buildRawMessage(email);

    const info = await transport.sendMail({ envelope: buildEnvelope(email), raw });

    await this.appendToSent(account, raw);

    return { providerMessageId: info.messageId };
  }

  /** Best-effort — the email already sent successfully by the time this
   *  runs, so a failure here (unsupported mailbox, transient IMAP outage)
   *  must never surface as a send failure. Falls back to letting the next
   *  scheduled inbound sync tick discover it naturally if the server itself
   *  already auto-copies SMTP sends to Sent (some do); this only covers the
   *  providers that don't. */
  private async appendToSent(account: EmailAccount, raw: Buffer): Promise<void> {
    if (!account.imapHost || !account.imapUsername || !account.imapPasswordEnc) return;
    const client = createImapClient(this.encryption, account);
    try {
      await client.connect();
      const sentMailbox = await findSentMailbox(client);
      if (!sentMailbox) {
        this.logger.warn(`No Sent folder found for ${account.address} — sent copy not saved`);
        return;
      }
      await client.append(sentMailbox, raw, ["\\Seen"]);
    } catch (err) {
      this.logger.warn(`Could not append sent copy to ${account.address}'s Sent folder: ${(err as Error).message}`);
    } finally {
      await client.logout().catch(() => client.close());
    }
  }
}

function buildEnvelope(email: OutboundEmail) {
  return {
    from: email.fromAddress,
    to: [email.toAddress, ...(email.cc ?? []), ...(email.bcc ?? [])],
  };
}

function buildRawMessage(email: OutboundEmail): Promise<Buffer> {
  const composer = new MailComposer({
    from: formatFrom(email.fromAddress, email.fromName),
    to: email.toAddress,
    cc: email.cc,
    bcc: email.bcc,
    subject: email.subject,
    html: email.bodyHtml,
    headers: email.headers,
    attachments: email.attachments?.map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.contentBase64, "base64"),
      contentType: a.contentType,
    })),
  });
  return new Promise((resolve, reject) => {
    composer.compile().build((err, message) => {
      if (err) return reject(err);
      resolve(message);
    });
  });
}
