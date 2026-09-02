import { Logger } from "@nestjs/common";
import { EmailAccount } from "@prisma/client";
import { ImapFlow } from "imapflow";
import { EncryptionService } from "../../common/crypto/encryption.service";

/** Common non-Gmail Sent-folder names, tried in order when a server doesn't
 *  advertise the IMAP SPECIAL-USE (RFC 6154) \Sent flag — most servers that
 *  lack SPECIAL-USE still use one of these verbatim. Gmail (both consumer
 *  and Workspace) always advertises SPECIAL-USE, so "[Gmail]/Sent Mail"
 *  isn't needed here as a fallback, only as a real-world example of why
 *  fallback-by-guessing alone would be wrong. */
export const SENT_FOLDER_FALLBACKS = ["Sent", "Sent Items", "Sent Messages", "INBOX.Sent"];

const logger = new Logger("ImapConnection");

/** Shared IMAP connection factory (Part: Email Hub) — used by
 *  ImapReaderProvider's inbound sync/attachment fetch, and by SmtpProvider's
 *  post-send "append a copy to Sent" step, so both open a connection the
 *  exact same way instead of two independent implementations drifting apart. */
export function createImapClient(encryption: EncryptionService, account: EmailAccount): ImapFlow {
  if (!account.imapHost || !account.imapUsername || !account.imapPasswordEnc) {
    throw new Error(`Account ${account.address} has no IMAP credentials configured`);
  }

  const password = encryption.looksEncrypted(account.imapPasswordEnc)
    ? encryption.decrypt(account.imapPasswordEnc)
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
  // sync. The real failure (auth, connect, fetch, append) is still surfaced
  // normally via the rejected promises below — this only stops a stray
  // async error from being fatal.
  client.on("error", (err) => {
    logger.warn(`IMAP socket error for ${account.address} (non-fatal): ${(err as Error).message}`);
  });

  return client;
}

/** SPECIAL-USE (RFC 6154) is the reliable signal — every major provider that
 *  supports it (Gmail, Fastmail, Outlook.com, iCloud) tags the real Sent
 *  folder with `\Sent` regardless of its display name in whatever language
 *  the account is set to, which a hardcoded name list can't match. Servers
 *  without SPECIAL-USE fall back to trying common literal names. Returns
 *  null (not a default guess) when neither finds anything — an account with
 *  no Sent folder should sync zero Sent messages, not silently point at the
 *  wrong mailbox. */
export async function findSentMailbox(client: ImapFlow): Promise<string | null> {
  const mailboxes = await client.list();
  const bySpecialUse = mailboxes.find((m) => m.specialUse === "\\Sent");
  if (bySpecialUse) return bySpecialUse.path;

  const byName = mailboxes.find((m) => SENT_FOLDER_FALLBACKS.includes(m.path));
  return byName?.path ?? null;
}
