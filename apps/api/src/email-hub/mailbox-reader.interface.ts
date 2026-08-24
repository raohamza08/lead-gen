import { EmailAccount } from "@prisma/client";

/**
 * Abstracted read/sync interface (Part: Email Hub, mirrors
 * email-provider.interface.ts's send-side abstraction) so adding a mail
 * provider is a config + adapter change, not a rewrite of the sync worker
 * or the unified-inbox API. V1 ships one implementation, `ImapReaderProvider`
 * — it covers every provider including Gmail/Workspace (IMAP + app
 * password). A future `GmailApiReaderProvider` (once OAuth exists) or
 * `GraphReaderProvider` implements the same interface without touching
 * anything that calls it.
 */
export interface FetchedAttachment {
  filename: string;
  size: number;
  /** Set only for inline attachments referenced by the HTML body (cid:...). */
  contentId?: string;
}

export interface FetchedMessage {
  /** Provider-native id, paired with EmailAccount.id as the dedupe key
   *  (InboundEmailMessage's unique constraint). IMAP UID for this provider. */
  providerMessageId: string;
  fromName?: string;
  fromEmail: string;
  toEmails: string[];
  ccEmails: string[];
  bccEmails: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  receivedAt: Date;
  folder: string;
  hasAttachments: boolean;
  attachments: FetchedAttachment[];
  /** RFC 5322 `Message-ID` header — threading key. */
  messageIdHeader?: string;
  /** RFC 5322 `In-Reply-To` header — direct parent, when present. */
  inReplyTo?: string;
  /** RFC 5322 `References` header, split into individual message ids. */
  references?: string[];
}

export interface SyncResult {
  messages: FetchedMessage[];
  /** Cursor to persist on EmailAccount for the next poll — provider-opaque
   *  from the caller's perspective (IMAP UID as a string here). Null means
   *  "no messages existed, nothing to advance the cursor to." */
  newCursor: string | null;
}

export interface MailboxReader {
  /** `sinceCursor` is `EmailAccount.lastImapUid` (or the reader's own cursor
   *  field, if a future provider uses a different one) — null on the very
   *  first sync for this account. */
  sync(account: EmailAccount, sinceCursor: string | null): Promise<SyncResult>;
}
