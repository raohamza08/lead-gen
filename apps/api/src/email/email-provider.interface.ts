import { EmailAccount } from "@prisma/client";

/**
 * Abstracted send interface (Part B2) so swapping/adding a mail provider is a
 * config + adapter change, not a rewrite (Part H2 risk: vendor lock-in).
 */
export interface OutboundEmail {
  fromAddress: string;
  /** Display name shown next to the address in the recipient's inbox (e.g.
   *  "EurosHub Team" instead of the bare mailbox address). Optional so a
   *  provider stub still works with just an address. */
  fromName?: string;
  toAddress: string;
  subject: string;
  bodyHtml: string;
  /** Used to correlate inbound replies (In-Reply-To/References) back to the sequence (Part C6). */
  headers?: Record<string, string>;
}

/** RFC 5322 "display name" syntax — quoted, with internal quotes/backslashes escaped. */
export function formatFrom(address: string, name?: string): string {
  if (!name) return address;
  return `"${name.replace(/["\\]/g, "")}" <${address}>`;
}

export interface EmailProvider {
  /** `account` carries the per-mailbox credentials (OAuth refresh token / SMTP creds) — never global env secrets. */
  send(account: EmailAccount, email: OutboundEmail): Promise<{ providerMessageId: string }>;
}
