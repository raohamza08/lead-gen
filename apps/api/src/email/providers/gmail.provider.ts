import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EmailAccount } from "@prisma/client";
import { google } from "googleapis";
// nodemailer's MailComposer builds a correct RFC 2822 MIME message (headers,
// boundaries, base64 body) — reused here purely as a message builder, no SMTP
// transport involved; the built message is handed to the Gmail API instead.
import MailComposer from "nodemailer/lib/mail-composer";
import { EncryptionService } from "../../common/crypto/encryption.service";
import { EmailProvider, formatFrom, OutboundEmail } from "../email-provider.interface";

/**
 * Sends via the Gmail API (`users.messages.send`) using a per-mailbox OAuth2
 * refresh token (Part G1 — scoped to `gmail.send`, obtained out-of-band via a
 * one-time consent flow, stored on EmailAccount.oauthRefreshToken). Requires
 * GMAIL_OAUTH_CLIENT_ID/SECRET (the app registration) plus that per-account
 * refresh token; falls back to logging intent if either is missing so the
 * queue/worker pipeline stays exercisable without live credentials.
 */
@Injectable()
export class GmailProvider implements EmailProvider {
  private readonly logger = new Logger(GmailProvider.name);

  constructor(
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
  ) {}

  async send(account: EmailAccount, email: OutboundEmail): Promise<{ providerMessageId: string }> {
    const gmail = this.getAuthenticatedClient(account);
    if (!gmail) {
      this.logger.log(`[stub] would send via Gmail API: to=${email.toAddress} subject="${email.subject}"`);
      return { providerMessageId: `stub-gmail-${Date.now()}` };
    }

    const raw = await this.buildRawMessage(email);
    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });

    return { providerMessageId: res.data.id ?? `gmail-${Date.now()}` };
  }

  /** Exposed for the Gmail push-notification adapter (`history.list`/`messages.get`), not just sending. */
  getAuthenticatedClient(account: EmailAccount) {
    const clientId = this.config.get<string>("GMAIL_OAUTH_CLIENT_ID");
    const clientSecret = this.config.get<string>("GMAIL_OAUTH_CLIENT_SECRET");
    if (!clientId || !clientSecret || !account.oauthRefreshToken) return null;

    // Encrypted at rest since the Email Hub migration; tolerates a
    // still-plaintext legacy row (looksEncrypted distinguishes the two) so
    // no separate backfill blocks this from shipping.
    const refreshToken = this.encryption.looksEncrypted(account.oauthRefreshToken)
      ? this.encryption.decrypt(account.oauthRefreshToken)
      : account.oauthRefreshToken;

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return google.gmail({ version: "v1", auth: oauth2Client });
  }

  private buildRawMessage(email: OutboundEmail): Promise<string> {
    const composer = new MailComposer({
      from: formatFrom(email.fromAddress, email.fromName),
      to: email.toAddress,
      subject: email.subject,
      html: email.bodyHtml,
      headers: email.headers,
    });

    return new Promise((resolve, reject) => {
      composer.compile().build((err, message) => {
        if (err) return reject(err);
        resolve(message.toString("base64url"));
      });
    });
  }
}
