import { EmailAccount } from "@prisma/client";

/**
 * Abstracted send interface (Part B2) so swapping/adding a mail provider is a
 * config + adapter change, not a rewrite (Part H2 risk: vendor lock-in).
 */
export interface OutboundEmail {
  fromAddress: string;
  toAddress: string;
  subject: string;
  bodyHtml: string;
  /** Used to correlate inbound replies (In-Reply-To/References) back to the sequence (Part C6). */
  headers?: Record<string, string>;
}

export interface EmailProvider {
  /** `account` carries the per-mailbox credentials (OAuth refresh token / SMTP creds) — never global env secrets. */
  send(account: EmailAccount, email: OutboundEmail): Promise<{ providerMessageId: string }>;
}
