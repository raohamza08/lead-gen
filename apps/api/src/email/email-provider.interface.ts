import { randomUUID } from "crypto";
import { EmailAccount } from "@prisma/client";

/**
 * Abstracted send interface (Part B2) so swapping/adding a mail provider is a
 * config + adapter change, not a rewrite (Part H2 risk: vendor lock-in).
 */
export interface OutboundAttachment {
  filename: string;
  contentType?: string;
  /** Raw file bytes, base64-encoded — attachments are sent through, never
   *  persisted (same "metadata only, bytes not stored" stance the inbound
   *  side already takes on InboundEmailMessage.attachments). */
  contentBase64: string;
}

export interface OutboundEmail {
  fromAddress: string;
  /** Display name shown next to the address in the recipient's inbox (e.g.
   *  "EurosHub Team" instead of the bare mailbox address). Optional so a
   *  provider stub still works with just an address. */
  fromName?: string;
  /** A single address, or multiple comma-separated — nodemailer/Gmail's
   *  MailComposer both parse a comma-separated string as multiple
   *  recipients, so the outreach path (always one lead) and the Email Hub
   *  compose path (a user-entered list) share this one field. */
  toAddress: string;
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml: string;
  /** Used to correlate inbound replies (In-Reply-To/References) back to the sequence (Part C6). */
  headers?: Record<string, string>;
  attachments?: OutboundAttachment[];
}

/** RFC 5322 "display name" syntax — quoted, with internal quotes/backslashes escaped. */
export function formatFrom(address: string, name?: string): string {
  if (!name) return address;
  return `"${name.replace(/["\\]/g, "")}" <${address}>`;
}

/**
 * Ensures the outbound email carries an explicit RFC 5322 Message-ID header
 * rather than leaving each provider's own MailComposer to fabricate one
 * internally (Part: Email Hub Sent-view duplicate fix, 2026-09-02) — both
 * SmtpProvider and GmailProvider build the raw MIME separately from
 * whatever id their transport/API call happens to report back, so without
 * this the returned providerMessageId can silently be a completely
 * different value than the "Message-ID:" header actually embedded in the
 * sent message. That mismatch mattered once EmailHubService.recordSentMessage
 * started storing providerMessageId as messageIdHeader on the instantly-
 * written Sent-view row: EmailHubSyncWorker.persistMessage needs the exact
 * same value to recognize that row again once the real Sent-folder copy
 * syncs back in and promote it in place — a mismatch meant every sent email
 * silently duplicated in the Sent view the moment the next sync tick ran.
 */
export function ensureMessageId(email: OutboundEmail): { email: OutboundEmail; messageId: string } {
  const existing = email.headers?.["Message-ID"];
  if (existing) return { email, messageId: existing };
  const domain = email.fromAddress.split("@")[1] ?? email.fromAddress;
  const messageId = `<${randomUUID()}@${domain}>`;
  return { email: { ...email, headers: { ...email.headers, "Message-ID": messageId } }, messageId };
}

export interface EmailProvider {
  /** `account` carries the per-mailbox credentials (OAuth refresh token / SMTP creds) — never global env secrets. */
  send(account: EmailAccount, email: OutboundEmail): Promise<{ providerMessageId: string }>;
}
