import { Injectable, Logger } from "@nestjs/common";
import { EmailAccount } from "@prisma/client";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { EncryptionService } from "../../common/crypto/encryption.service";
import { FetchedMessage, MailboxReader, SyncResult } from "../mailbox-reader.interface";

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

  async sync(account: EmailAccount, sinceCursor: string | null): Promise<SyncResult> {
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

    await client.connect();
    try {
      const lock = await client.getMailboxLock("INBOX");
      try {
        return await this.fetchNew(client, sinceCursor);
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  private async fetchNew(client: ImapFlow, sinceCursor: string | null): Promise<SyncResult> {
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
        folder: "INBOX",
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
