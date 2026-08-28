import { Injectable, Logger } from "@nestjs/common";
import { EmailAccount } from "@prisma/client";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { EncryptionService } from "../../common/crypto/encryption.service";
import { FetchedMessage, MailboxReader, SyncResult } from "../mailbox-reader.interface";

/** Common non-Gmail Sent-folder names, tried in order when a server doesn't
 *  advertise the IMAP SPECIAL-USE (RFC 6154) \Sent flag — most servers that
 *  lack SPECIAL-USE still use one of these verbatim. Gmail (both consumer
 *  and Workspace) always advertises SPECIAL-USE, so "[Gmail]/Sent Mail"
 *  isn't needed here as a fallback, only as a real-world example of why
 *  fallback-by-guessing alone would be wrong. */
const SENT_FOLDER_FALLBACKS = ["Sent", "Sent Items", "Sent Messages", "INBOX.Sent"];

/** How far back to look on an account's very first sync — enough to make
 *  the unified inbox useful immediately without risking an unbounded
 *  historical import on a busy 10-year-old mailbox. Every sync after the
 *  first is purely incremental (UID > lastImapUid), so this only matters
 *  once per account. */
const INITIAL_BACKFILL_DAYS = 30;
/** Hard cap alongside the day window, for an account that received an
 *  unusually high volume in that window — one sync tick should never try
 *  to pull thousands of messages at once. The remainder catches up on
 *  subsequent polls since the cursor only advances to what was actually
 *  fetched. */
const INITIAL_BACKFILL_MAX = 200;

/**
 * IMAP implementation of MailboxReader (Part: Email Hub) — the one reader
 * V1 ships, and the one that makes this provider-independent rather than
 * Gmail/Hostinger-specific: any account with IMAP credentials works here
 * identically, including Gmail/Workspace via an app password. A future
 * Gmail-API-based reader (once OAuth exists, Phase 2) implements the same
 * MailboxReader interface without this class or its caller changing.
 */
@Injectable()
export class ImapReaderProvider implements MailboxReader {
  private readonly logger = new Logger(ImapReaderProvider.name);

  constructor(private readonly encryption: EncryptionService) {}

  async sync(
    account: EmailAccount,
    cursors: { inbox: string | null; sent: string | null },
  ): Promise<{ inbox: SyncResult; sent: SyncResult }> {
    if (!account.imapHost || !account.imapUsername || !account.imapPasswordEnc) {
      throw new Error(`Account ${account.address} has no IMAP credentials configured`);
    }

    const password = this.encryption.looksEncrypted(account.imapPasswordEnc)
      ? this.encryption.decrypt(account.imapPasswordEnc)
      : account.imapPasswordEnc; // legacy/manually-entered plaintext, tolerated on read only

    const secure = account.imapEncryption === "SSL";
    const client = new ImapFlow({
      host: account.imapHost,
      port: account.imapPort ?? (secure ? 993 : 143),
      secure,
      auth: { user: account.imapUsername, pass: password },
      logger: false, // imapflow's own pino logger is far too verbose for a per-account poll worker
    });

    // ImapFlow emits 'error' on socket-level failures (e.g. a timeout on the
    // underlying TLSSocket) independently of connect()/fetch()'s own promise
    // rejections — a well-known Node EventEmitter trap: an 'error' event with
    // no listener throws and crashes the whole process, not just this call.
    // Confirmed live: a bad password left a socket that later hit ETIMEOUT
    // during cleanup and took the entire API down, not just this account's
    // sync. The real failure (auth, connect, fetch) is still surfaced
    // normally via the rejected promises below — this only stops a stray
    // async error from being fatal.
    client.on("error", (err) => {
      this.logger.warn(`IMAP socket error for ${account.address} (non-fatal): ${(err as Error).message}`);
    });

    await client.connect();
    try {
      const inbox = await this.syncMailbox(client, "INBOX", cursors.inbox, "INBOX");

      const sentMailbox = await this.findSentMailbox(client);
      const sent = sentMailbox
        ? await this.syncMailbox(client, sentMailbox, cursors.sent, "SENT")
        : { messages: [], newCursor: cursors.sent };
      if (!sentMailbox) {
        this.logger.warn(`No Sent-equivalent folder found for this account — Sent view will stay empty`);
      }

      return { inbox, sent };
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  /** SPECIAL-USE (RFC 6154) is the reliable signal — every major provider
   *  that supports it (Gmail, Fastmail, Outlook.com, iCloud) tags the real
   *  Sent folder with `\Sent` regardless of its display name in whatever
   *  language the account is set to, which a hardcoded name list can't
   *  match. Servers without SPECIAL-USE fall back to trying common literal
   *  names. Returns null (not a default guess) when neither finds anything
   *  — an account with no Sent folder should sync zero Sent messages, not
   *  silently point at the wrong mailbox. */
  private async findSentMailbox(client: ImapFlow): Promise<string | null> {
    const mailboxes = await client.list();
    const bySpecialUse = mailboxes.find((m) => m.specialUse === "\\Sent");
    if (bySpecialUse) return bySpecialUse.path;

    const byName = mailboxes.find((m) => SENT_FOLDER_FALLBACKS.includes(m.path));
    return byName?.path ?? null;
  }

  private async syncMailbox(
    client: ImapFlow,
    mailboxPath: string,
    sinceCursor: string | null,
    folderLabel: string,
  ): Promise<SyncResult> {
    const lock = await client.getMailboxLock(mailboxPath);
    try {
      return await this.fetchNew(client, sinceCursor, folderLabel);
    } finally {
      lock.release();
    }
  }

  private async fetchNew(client: ImapFlow, sinceCursor: string | null, folderLabel: string): Promise<SyncResult> {
    let uids: number[];
    if (sinceCursor === null) {
      const since = new Date(Date.now() - INITIAL_BACKFILL_DAYS * 24 * 60 * 60 * 1000);
      const found = await client.search({ since }, { uid: true });
      uids = (found || []).slice(-INITIAL_BACKFILL_MAX);
    } else {
      const cursor = Number(sinceCursor);
      const found = await client.search({ uid: `${cursor + 1}:*` }, { uid: true });
      // A search with no matches above the cursor still returns [cursor] on
      // some servers per RFC 3501's "largest UID" fallback behavior for an
      // open-ended range — filter it back out rather than re-fetching what's
      // already been processed.
      uids = (found || []).filter((uid) => uid > cursor);
    }

    if (uids.length === 0) {
      return { messages: [], newCursor: sinceCursor };
    }

    const messages: FetchedMessage[] = [];
    let highestUid = sinceCursor ? Number(sinceCursor) : 0;

    for await (const raw of client.fetch(uids, { uid: true, envelope: true, source: true }, { uid: true })) {
      if (!raw.source) continue;
      const parsed = await simpleParser(raw.source);

      const toEmails = (parsed.to ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to]) : [])
        .flatMap((a) => a.value.map((v) => v.address).filter((a): a is string => !!a));
      const ccEmails = (parsed.cc ? (Array.isArray(parsed.cc) ? parsed.cc : [parsed.cc]) : [])
        .flatMap((a) => a.value.map((v) => v.address).filter((a): a is string => !!a));
      const bccEmails = (parsed.bcc ? (Array.isArray(parsed.bcc) ? parsed.bcc : [parsed.bcc]) : [])
        .flatMap((a) => a.value.map((v) => v.address).filter((a): a is string => !!a));
      const fromAddress = parsed.from?.value[0];

      messages.push({
        providerMessageId: String(raw.uid),
        fromName: fromAddress?.name || undefined,
        fromEmail: fromAddress?.address ?? "unknown@unknown",
        toEmails,
        ccEmails,
        bccEmails,
        subject: parsed.subject ?? "(no subject)",
        bodyText: parsed.text ?? "",
        bodyHtml: parsed.html || undefined,
        receivedAt: parsed.date ?? raw.envelope?.date ?? new Date(),
        folder: folderLabel,
        hasAttachments: parsed.attachments.length > 0,
        attachments: parsed.attachments.map((a) => ({
          filename: a.filename ?? "attachment",
          size: a.size,
          contentId: a.cid,
        })),
        messageIdHeader: parsed.messageId,
        inReplyTo: parsed.inReplyTo,
        references: Array.isArray(parsed.references)
          ? parsed.references
          : parsed.references
            ? [parsed.references]
            : undefined,
      });

      if (raw.uid > highestUid) highestUid = raw.uid;
    }

    return { messages, newCursor: String(highestUid) };
  }
}
