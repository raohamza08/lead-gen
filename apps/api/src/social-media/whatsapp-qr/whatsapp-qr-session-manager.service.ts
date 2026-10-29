import { BadRequestException, Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import * as path from "path";
import { promises as fs } from "fs";
import * as QRCode from "qrcode";
import type { WASocket, WAMessage, ConnectionState } from "@whiskeysockets/baileys";
import { PrismaService } from "../../common/prisma/prisma.service";
import { RealtimeGateway } from "../../realtime/realtime.gateway";
import { SocialInboxIngestService } from "../social-inbox-ingest.service";
import { MEDIA_STORAGE_SERVICE, MediaStorageService } from "../media/media-storage.interface";
import { NotificationsService } from "../../notifications/notifications.service";
import { NotificationCategory } from "@prisma/client";

type BaileysModule = typeof import("@whiskeysockets/baileys");

const SEND_JITTER_MS = [800, 2200] as const;

/**
 * Owns every live Baileys socket for a WHATSAPP_QR SocialAccount (Part:
 * WhatsApp Team Inbox, 2026-10-26). One process, one in-memory Map of open
 * sockets -- the Hetzner deployment runs the API as a single long-lived
 * process per host, so this is sound without any cross-process
 * coordination; a redeploy's restart just calls connect() again for every
 * previously-CONNECTED session (see onModuleInit), reusing the saved local
 * auth state instead of prompting a new QR scan.
 *
 * Baileys ships ESM-only (`"type": "module"`) while this API compiles to
 * CommonJS -- `lib()` below loads it via a dynamic `import()` the one time
 * it's needed, which is the standard interop path for a CJS consumer of an
 * ESM-only package; a static `import` here would fail to compile/load.
 *
 * WhatsAppQrSession (Postgres) only tracks status for the UI/API -- the
 * actual creds/signal keys live on local disk under WHATSAPP_SESSION_DIR
 * (one folder per account, via Baileys' own useMultiFileAuthState), never
 * in the DB. Losing that folder just means re-scanning a QR code.
 */
@Injectable()
export class WhatsAppQrSessionManagerService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppQrSessionManagerService.name);
  private readonly sockets = new Map<string, WASocket>();
  /** Who clicked "connect" for a session still awaiting its QR scan/open --
   *  the only user the QR image and connected confirmation get pushed to
   *  (RealtimeGateway.emitToUser), not the whole org. Cleared once CONNECTED
   *  or on a failed connect; absent entirely for a resumed session (nobody
   *  is watching a modal for an auto-resume after a restart). */
  private readonly connectingUsers = new Map<string, string>();
  /** Serializes sends per account so two near-simultaneous replies from two
   *  different team members don't race on the same socket, and lets a
   *  small randomized delay land between them (Part: anti-spam-pattern
   *  honest-effort measure -- not a guarantee against a ban, just not
   *  machine-gunning messages the instant two agents happen to reply at
   *  once). */
  private readonly sendQueues = new Map<string, Promise<void>>();
  /** Small on-demand-lookup cache (profile picture URLs, group subjects),
   *  keyed with an own prefix per kind of lookup -- fetched once per
   *  contact/group per process lifetime rather than once per message
   *  (Part: WhatsApp Team Inbox profile pictures, 2026-10-26; group
   *  support, 2026-10-26) since both sock.profilePictureUrl and
   *  sock.groupMetadata are real network round trips; either changing
   *  mid-session is an acceptable miss given this is a low-volume shared
   *  inbox, not a cache this app needs to actively invalidate. */
  private readonly lookupCache = new Map<string, string>();
  private baileys?: BaileysModule;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly ingest: SocialInboxIngestService,
    private readonly notifications: NotificationsService,
    @Inject(MEDIA_STORAGE_SERVICE) private readonly storage: MediaStorageService,
  ) {}

  private async lib(): Promise<BaileysModule> {
    if (!this.baileys) this.baileys = await import("@whiskeysockets/baileys");
    return this.baileys;
  }

  private sessionDir(accountId: string): string {
    const root = process.env.WHATSAPP_SESSION_DIR || path.join(process.cwd(), "storage", "whatsapp-sessions");
    return path.join(root, accountId);
  }

  /** Auto-resumes every number that was CONNECTED before this process last
   *  stopped -- what makes a deploy-triggered restart not require everyone
   *  to re-scan a QR code. */
  async onModuleInit() {
    const sessions = await this.prisma.whatsAppQrSession.findMany({ where: { status: "CONNECTED" } });
    for (const session of sessions) {
      this.connect(session.socialAccountId).catch((err) =>
        this.logger.error(`Failed to resume WhatsApp QR session for account ${session.socialAccountId}: ${(err as Error).message}`),
      );
    }
  }

  async startNewSession(orgId: string, userId: string, label?: string): Promise<{ accountId: string }> {
    const trimmed = label?.trim();
    // SocialAccount has a unique (orgId, platform, username) constraint --
    // every platform's "username" is its real handle once connected, but
    // pre-connection there's no handle yet, so an un-numbered default
    // ("WhatsApp Number") would collide on every second number connected
    // without a custom label. Numbering against the existing count keeps
    // the pre-connect label unique and still human-readable; connect()
    // overwrites it with the real phone number once the QR is scanned.
    const existingCount = await this.prisma.socialAccount.count({ where: { orgId, platform: "WHATSAPP_QR" } });
    const username = trimmed || `WhatsApp Number ${existingCount + 1}`;
    const account = await this.prisma.socialAccount.create({
      data: {
        orgId,
        platform: "WHATSAPP_QR",
        username,
        displayName: trimmed || username,
        status: "DISCONNECTED",
        connectedByUserId: userId,
        connectedAt: new Date(),
      },
    });
    await this.prisma.whatsAppQrSession.create({ data: { socialAccountId: account.id, status: "CONNECTING" } });
    this.connectingUsers.set(account.id, userId);
    this.connect(account.id).catch((err) => {
      this.logger.error(`WhatsApp QR connect failed for new account ${account.id}: ${(err as Error).message}`);
      this.connectingUsers.delete(account.id);
    });
    return { accountId: account.id };
  }

  /** Ends and discards any socket already held for `accountId`, if any, so
   *  a following connect() is guaranteed to open a genuinely fresh one
   *  instead of hitting connect()'s own no-op guard (Part: WhatsApp Team
   *  Inbox reliability, 2026-10-29). A QR_PENDING session still holds a
   *  "live" socket object in `sockets` -- it was never deleted, only
   *  `connection === "close"` does that -- so WhatsAppQrReconnectWorker's
   *  retry of a stuck QR_PENDING session would otherwise silently no-op
   *  forever against the same stale socket, confirmed as the real
   *  explanation for two numbers sitting dead for ~2 days: nothing ever
   *  forced a genuinely new connection attempt. */
  async forceReconnect(accountId: string): Promise<void> {
    const existing = this.sockets.get(accountId);
    if (existing) {
      this.sockets.delete(accountId);
      await Promise.resolve(existing.end(undefined)).catch(() => undefined);
    }
    await this.connect(accountId);
  }

  async connect(accountId: string): Promise<void> {
    if (this.sockets.has(accountId)) return;
    const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = await this.lib();
    const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir(accountId));
    const { version } = await fetchLatestBaileysVersion();

    // true -- asks WhatsApp to replay existing chat history on first connect
    // (Part: WhatsApp Team Inbox history backfill, 2026-10-26, explicit user
    // request -- a freshly connected real number showed zero conversations
    // otherwise, same limitation the Cloud API connection already has but
    // Baileys can actually avoid). Arrives async via messaging-history.set,
    // not messages.upsert.
    const sock = makeWASocket({ auth: state, version, syncFullHistory: true });
    this.sockets.set(accountId, sock);

    sock.ev.on("creds.update", saveCreds);
    // Baileys' event emitter never awaits/catches a listener's returned
    // promise -- an uncaught rejection here becomes a process-level
    // unhandledRejection, which crashes the ENTIRE API (confirmed in
    // production, 2026-10-26: a stale socket's connection.update fired
    // after its SocialAccount/WhatsAppQrSession rows had been deleted
    // through an unrelated path, the resulting P2025 went unhandled, and
    // took down every other request in flight, not just this account).
    // Every listener below must end in .catch(), no exceptions.
    sock.ev.on("connection.update", (update) =>
      this.handleConnectionUpdate(accountId, update).catch((err) => {
        this.logger.error(`connection.update handling failed for account ${accountId}: ${(err as Error).message}`);
        // The DB rows this socket answers to are gone (deleted through some
        // other path) -- stop holding a live connection open for them.
        this.sockets.delete(accountId);
        sock.end(undefined);
      }),
    );
    sock.ev.on("messages.upsert", ({ messages }) => {
      for (const message of messages) {
        this.ingestMessage(accountId, message, { isHistoryBackfill: false, contactName: message.pushName || undefined }).catch((err) =>
          this.logger.error(`Failed to ingest WhatsApp message on account ${accountId}: ${(err as Error).message}`),
        );
      }
    });
    // Replayed chat history (can fire more than once as sync progresses --
    // recent chats first, older ones in later chunks). Same message shape
    // and ingestion path as messages.upsert above, just flagged so it
    // doesn't inflate unreadCount or spam a notification per historical
    // message (Part: WhatsApp Team Inbox history backfill, 2026-10-26).
    //
    // message.pushName is usually empty on a replayed history message (it's
    // populated from live delivery context, not stored history) -- this
    // event carries its own `contacts` list instead (the real saved/self-set
    // name per JID), which is what actually fixed "only showing the number,
    // not the name" (Part: WhatsApp Team Inbox contact names, 2026-10-26).
    sock.ev.on("messaging-history.set", async ({ messages, contacts, chats, lidPnMappings }) => {
      // WhatsApp's newer LID (Linked ID) privacy system routes some contacts
      // through an opaque per-chat id (`<digits>@lid`) instead of their real
      // phone-number JID (`<digits>@s.whatsapp.net`) -- confirmed in
      // production, 2026-10-26: every externalConversationId for one
      // connected number was a LID, not a phone number, which is also why
      // name lookups kept missing (contacts/chats here are keyed by the
      // real JID, not the LID). storeLIDPNMappings populates Baileys' own
      // resolver (sock.signalRepository.lidMapping) so resolveContactJid
      // below can look up the real number where WhatsApp allows it.
      if (lidPnMappings?.length) {
        await sock.signalRepository.lidMapping.storeLIDPNMappings(lidPnMappings).catch((err: Error) =>
          this.logger.warn(`Failed to store LID/PN mappings for account ${accountId}: ${err.message}`),
        );
      }
      // Chat-level names cover numbers that aren't a saved contact at all --
      // the common case for a business getting messages from customers --
      // filled in first so the (more authoritative, "saved in your phone")
      // contacts list below can override where both exist.
      const nameByJid = new Map<string, string>();
      for (const chat of chats) {
        if (chat.id && chat.name) nameByJid.set(chat.id, chat.name);
      }
      for (const contact of contacts) {
        const name = contact.name || contact.notify;
        if (name) nameByJid.set(contact.id, name);
      }
      for (const message of messages) {
        this.ingestMessage(accountId, message, { isHistoryBackfill: true, nameByJid }).catch((err) =>
          this.logger.error(`Failed to ingest WhatsApp history message on account ${accountId}: ${(err as Error).message}`),
        );
      }
    });
  }

  /** Resolves a possibly-LID `remoteJid` to the real phone-number JID via
   *  Baileys' own LID<->PN resolver where WhatsApp allows it, returning the
   *  bare digits for a normal contact. When the real number isn't
   *  resolvable (WhatsApp withholding it under the LID privacy system), the
   *  full `<digits>@lid` form is kept as-is so sendMessage's existing
   *  `includes("@")` check still addresses the right network instead of
   *  wrongly treating the LID digits as a phone number. */
  private async resolveContactJid(accountId: string, remoteJid: string): Promise<string> {
    if (!remoteJid.endsWith("@lid")) return remoteJid.split("@")[0];
    const sock = this.sockets.get(accountId);
    const lid = remoteJid.split("@")[0];
    const pn = await sock?.signalRepository.lidMapping.getPNForLID(lid).catch(() => null);
    return pn ? pn.split("@")[0] : remoteJid;
  }

  private async getProfilePictureUrl(accountId: string, jid: string): Promise<string | undefined> {
    const cacheKey = `avatar:${accountId}:${jid}`;
    const cached = this.lookupCache.get(cacheKey);
    if (cached) return cached;
    const sock = this.sockets.get(accountId);
    const url = await sock?.profilePictureUrl(jid, "preview").catch(() => undefined);
    if (url) this.lookupCache.set(cacheKey, url);
    return url;
  }

  /** Live messages (no chats-list nameByJid to fall back on) need an
   *  on-demand lookup for a group's subject (Part: WhatsApp Team Inbox
   *  group support, 2026-10-26) -- cached the same way as profile
   *  pictures, since it's a real network round trip. */
  private async getGroupSubject(accountId: string, jid: string): Promise<string | undefined> {
    const cacheKey = `group-subject:${accountId}:${jid}`;
    const cached = this.lookupCache.get(cacheKey);
    if (cached) return cached;
    const sock = this.sockets.get(accountId);
    const subject = await sock?.groupMetadata(jid).then((m) => m.subject).catch(() => undefined);
    if (subject) this.lookupCache.set(cacheKey, subject);
    return subject;
  }

  /** Flags a WhatsApp number as actually down -- fixing a real production
   *  bug (Part: WhatsApp Team Inbox reliability, 2026-10-29, direct user
   *  report of lost messages): every close branch below used to update
   *  WhatsAppQrSession.status but NOT SocialAccount.status except on an
   *  explicit logout, so the Numbers tab (which only ever reads
   *  SocialAccount.status) kept showing "Connected" for a number that had
   *  actually been down for hours -- confirmed live in production, two
   *  real numbers sat dead for ~2 days this way. Idempotent by design
   *  (checks the current status first) so a flaky connection retrying
   *  every 30s only ever sends ONE notification per real outage, not one
   *  per failed retry. */
  private async markAccountDown(accountId: string, reason: string): Promise<void> {
    const account = await this.prisma.socialAccount.findUnique({ where: { id: accountId } });
    if (!account || account.status === "DISCONNECTED") return;
    await this.prisma.socialAccount.update({ where: { id: accountId }, data: { status: "DISCONNECTED" } });
    await this.notifications.notify(account.orgId, {
      category: NotificationCategory.SOCIAL,
      type: "WHATSAPP_QR_DISCONNECTED",
      title: "WhatsApp number disconnected",
      message: `${account.displayName || account.username} went offline (${reason}) and is no longer receiving messages. ${
        reason === "needs_qr" ? "Open the Numbers tab to scan a fresh QR code." : "It will keep retrying automatically."
      }`,
      severity: "ERROR",
      entityType: "socialAccount",
      entityId: account.id,
      actionUrl: "/social-media/whatsapp-qr?tab=numbers",
      forceEmail: true,
    });
  }

  /** Mirror of markAccountDown for the good-news case -- a "resolved" email
   *  only fires when the number was actually flagged down first, never on
   *  a routine first-time connect. */
  private async markAccountUp(accountId: string): Promise<void> {
    const account = await this.prisma.socialAccount.findUnique({ where: { id: accountId } });
    if (account && account.status === "DISCONNECTED") {
      await this.notifications.notify(account.orgId, {
        category: NotificationCategory.SOCIAL,
        type: "WHATSAPP_QR_RECONNECTED",
        title: "WhatsApp number back online",
        message: `${account.displayName || account.username} reconnected and is receiving messages again.`,
        severity: "WARNING",
        entityType: "socialAccount",
        entityId: account.id,
        actionUrl: "/social-media/whatsapp-qr?tab=numbers",
        emailTone: "resolved",
      });
    }
  }

  private async handleConnectionUpdate(accountId: string, update: Partial<ConnectionState>) {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      const qrDataUrl = await QRCode.toDataURL(qr);
      // Persisted unconditionally, not just pushed to whoever's watching
      // (Part: WhatsApp Team Inbox reliability, 2026-10-29) -- a QR raised
      // by the automatic reconnect sweep (nobody mid-click in the UI) used
      // to just vanish; the Numbers tab now polls this same field so
      // anyone who opens it sees a scannable code within one reconnect
      // cooldown, not only the person who happened to click "Connect".
      await this.prisma.whatsAppQrSession.update({
        where: { socialAccountId: accountId },
        data: { status: "QR_PENDING", lastQrAt: new Date(), pendingQrDataUrl: qrDataUrl },
      });
      // Needing a fresh QR always means "not actually connected right
      // now" regardless of who triggered this connect() call -- fix for
      // the same status-desync bug described on markAccountDown.
      await this.markAccountDown(accountId, "needs_qr");
      const requestingUserId = this.connectingUsers.get(accountId);
      if (requestingUserId) {
        this.realtime.emitToUser(requestingUserId, "whatsappQr.qr", { accountId, qrDataUrl });
      }
    }

    if (connection === "open") {
      await this.markAccountUp(accountId);
      const sock = this.sockets.get(accountId);
      const phoneNumber = sock?.user?.id?.split(":")[0];
      // Settle the display username on the real number once connected --
      // best-effort: a stale row from a prior disconnected session for the
      // same number could already hold this username (unique per
      // orgId+platform+username), which must never fail the actual
      // WhatsApp connection over a cosmetic field.
      if (phoneNumber) {
        await this.prisma.socialAccount
          .update({ where: { id: accountId }, data: { username: phoneNumber } })
          .catch((err) => this.logger.warn(`Could not settle username to phone number for account ${accountId}: ${(err as Error).message}`));
      }
      const account = await this.prisma.socialAccount.update({
        where: { id: accountId },
        data: { status: "CONNECTED", externalAccountId: phoneNumber, connectedAt: new Date() },
      });
      await this.prisma.whatsAppQrSession.update({
        where: { socialAccountId: accountId },
        // Stale QR is useless the instant the session is actually
        // connected -- clear it so the Numbers tab stops showing a dead
        // code (Part: WhatsApp Team Inbox reliability, 2026-10-29).
        data: { status: "CONNECTED", lastConnectedAt: new Date(), disconnectReason: null, pendingQrDataUrl: null },
      });
      const requestingUserId = this.connectingUsers.get(accountId);
      if (requestingUserId) {
        this.realtime.emitToUser(requestingUserId, "whatsappQr.connected", { accountId, phoneNumber: account.externalAccountId });
      }
      this.connectingUsers.delete(accountId);
    }

    if (connection === "close") {
      this.sockets.delete(accountId);
      const { DisconnectReason } = await this.lib();
      const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;

      if (statusCode === DisconnectReason.restartRequired) {
        // Expected, normal part of the pairing handshake -- WhatsApp's
        // server always closes the stream once right after a QR scan
        // succeeds, and expects an immediate reconnect using the SAME
        // saved auth state to actually finish logging in (confirmed in
        // production, 2026-10-26: logs showed "pairing configured
        // successfully" immediately followed by this exact close code).
        // Not a failure -- must not notify the frontend or clear
        // connectingUsers, just reconnect right away.
        await this.connect(accountId);
      } else if (statusCode === DisconnectReason.loggedOut) {
        await this.prisma.whatsAppQrSession.update({
          where: { socialAccountId: accountId },
          data: { status: "LOGGED_OUT", lastDisconnectedAt: new Date(), disconnectReason: "logged_out", pendingQrDataUrl: null },
        });
        await this.markAccountDown(accountId, "logged out");
        await fs.rm(this.sessionDir(accountId), { recursive: true, force: true }).catch(() => undefined);
        const requestingUserId = this.connectingUsers.get(accountId);
        if (requestingUserId) this.realtime.emitToUser(requestingUserId, "whatsappQr.loggedOut", { accountId });
        this.connectingUsers.delete(accountId);
      } else {
        // Anything other than an explicit logout is left for
        // WhatsAppQrReconnectWorker's sweep to retry with backoff, not
        // retried inline here -- a flaky network blip shouldn't become an
        // unbounded retry loop on this same event handler. The sweep now
        // retries this status too (Part: WhatsApp Team Inbox reliability,
        // 2026-10-29 -- "make sure the connection doesn't go down until I
        // disconnect them"), same 30s cooldown as before.
        await this.prisma.whatsAppQrSession.update({
          where: { socialAccountId: accountId },
          data: { status: "DISCONNECTED", lastDisconnectedAt: new Date(), disconnectReason: String(statusCode ?? "unknown") },
        });
        await this.markAccountDown(accountId, "connection dropped");
        const requestingUserId = this.connectingUsers.get(accountId);
        if (requestingUserId) {
          this.realtime.emitToUser(requestingUserId, "whatsappQr.disconnected", { accountId });
          this.connectingUsers.delete(accountId);
        }
      }
    }
  }

  private async ingestMessage(
    accountId: string,
    message: WAMessage,
    opts: { isHistoryBackfill: boolean; contactName?: string; nameByJid?: Map<string, string> },
  ): Promise<void> {
    const remoteJid = message.key.remoteJid;
    if (!remoteJid || remoteJid === "status@broadcast") return; // status updates aren't a conversation
    if (!message.message) return; // protocol/reaction-only messages carry no content worth persisting

    const isGroup = remoteJid.endsWith("@g.us");
    const contactNumber = await this.resolveContactJid(accountId, remoteJid);
    // For a group, the "contact" is the group itself -- its subject (Part:
    // WhatsApp Team Inbox group support, 2026-10-26, explicit user request
    // -- "the groups are not coming up on whatsapp"). History-sync's
    // chats list already covers this via nameByJid (group subjects live
    // in the same list as 1:1 contact names); a live message has no such
    // list, so it's fetched on demand and cached, same reasoning as
    // getProfilePictureUrl below.
    const contactName = isGroup
      ? opts.nameByJid?.get(remoteJid) || (await this.getGroupSubject(accountId, remoteJid))
      : opts.contactName || opts.nameByJid?.get(remoteJid) || undefined;
    // Who within the group actually sent this (inbound only -- message.key.
    // participant is only ever present on a group message). Visible to
    // everyone, unlike the outbound team-member attribution below -- see
    // SocialInboxService.getConversation's own stripping logic, which is
    // scoped to fromUs only for exactly this reason.
    const groupSenderName =
      isGroup && !message.key.fromMe
        ? (message.key.participant && opts.nameByJid?.get(message.key.participant)) || message.pushName || undefined
        : undefined;
    // Baileys' protobuf-generated message types are a deep tree of optional
    // fields with no shared base -- read loosely here rather than fighting
    // the exact union of IImageMessage/IVideoMessage/IAudioMessage/
    // IDocumentMessage, same pragmatic looseness their own examples use.
    const rawContent = message.message as Record<string, any>;
    // View-once photos/videos and the newer "document with caption" wrapper
    // both nest the real message one level down under `.message` (Part:
    // WhatsApp message-type coverage, 2026-10-29, explicit user report of
    // missing messages) -- unwrapped here so every check below sees the
    // real imageMessage/videoMessage/documentMessage either way, instead of
    // silently falling through to "no text, no media" for anything sent as
    // a view-once photo.
    const content: Record<string, any> =
      rawContent.viewOnceMessage?.message ??
      rawContent.viewOnceMessageV2?.message ??
      rawContent.viewOnceMessageV2Extension?.message ??
      rawContent.documentWithCaptionMessage?.message ??
      rawContent;
    const mediaContent: Record<string, any> | undefined =
      content.imageMessage ?? content.videoMessage ?? content.audioMessage ?? content.documentMessage ?? content.stickerMessage;
    const mediaType: "image" | "video" | "audio" | "document" | "sticker" | undefined = content.imageMessage
      ? "image"
      : content.videoMessage
        ? "video"
        : content.audioMessage
          ? "audio"
          : content.documentMessage
            ? "document"
            : content.stickerMessage
              ? "sticker"
              : undefined;

    let media: { url: string; mimeType: string; filename: string } | undefined;
    if (mediaContent && mediaType) {
      media = await this.downloadAndStoreMedia(accountId, mediaContent, mediaType).catch((err) => {
        this.logger.error(`Failed to download WhatsApp ${mediaType} for account ${accountId}: ${(err as Error).message}`);
        return undefined;
      });
    }
    // Message types with no file to download at all -- location pins,
    // shared contact cards, and polls (Part: WhatsApp message-type
    // coverage, 2026-10-29) -- previously hit the bare `!text && !media`
    // check below and vanished with zero trace. Each formatted as a plain
    // text line rather than invented media, since none of them are
    // actually a file.
    const location = content.locationMessage ?? content.liveLocationMessage;
    const contactCard = content.contactMessage;
    const contactsArray = content.contactsArrayMessage;
    const poll = content.pollCreationMessage ?? content.pollCreationMessageV3;
    const structuredText = location
      ? `📍 Location: ${location.name || location.address || `${location.degreesLatitude}, ${location.degreesLongitude}`}`
      : contactCard
        ? `👤 Contact card: ${contactCard.displayName || "shared contact"}`
        : contactsArray
          ? `👤 Contact card: ${(contactsArray.contacts ?? []).map((c: Record<string, any>) => c.displayName).filter(Boolean).join(", ") || "shared contacts"}`
          : poll
            ? `📊 Poll: ${poll.name}${poll.options?.length ? ` (${poll.options.map((o: Record<string, any>) => o.optionName).join(", ")})` : ""}`
            : undefined;
    // Real caption if there is one; if media downloaded fine with no
    // caption, no text at all (Part: WhatsApp media-caption parity,
    // 2026-10-27, explicit user request -- "it should work exactly like
    // whatsapp" -- real WhatsApp shows no caption bubble for an uncaptioned
    // photo). The "[image]"/"[video]"/etc. placeholder now only appears as
    // a fallback when the download actually failed, so something is still
    // visible rather than a silently empty message.
    const text =
      content.conversation ??
      content.extendedTextMessage?.text ??
      mediaContent?.caption ??
      structuredText ??
      (mediaType && !media ? `[${mediaType}]` : undefined);
    if (!text && !media) return; // genuinely content-free (a reaction, a protocol message, etc.) -- correctly skipped, not a gap

    const account = await this.prisma.socialAccount.findUniqueOrThrow({ where: { id: accountId } });
    // contactNumber keeps its "@lid" suffix when the real number isn't
    // resolvable (needed so a later reply targets the right network) --
    // strip it just for the human-facing username fallback.
    const displayNumber = contactNumber.replace(/@lid$/, "");
    const contactProfileImageUrl = await this.getProfilePictureUrl(accountId, remoteJid);
    await this.ingest.persistMessage(account, {
      externalConversationId: contactNumber,
      contactExternalId: contactNumber,
      contactUsername: displayNumber,
      contactName,
      contactProfileImageUrl,
      senderName: groupSenderName,
      externalMessageId: message.key.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      fromUs: Boolean(message.key.fromMe),
      messageText: text,
      mediaUrl: media?.url,
      mediaMimeType: media?.mimeType,
      mediaFilename: media?.filename,
      sentAt: message.messageTimestamp ? new Date(Number(message.messageTimestamp) * 1000) : new Date(),
      isHistoryBackfill: opts.isHistoryBackfill,
    });
  }

  private async downloadAndStoreMedia(
    accountId: string,
    mediaContent: Record<string, any>,
    mediaType: "image" | "video" | "audio" | "document" | "sticker",
  ): Promise<{ url: string; mimeType: string; filename: string }> {
    const { downloadContentFromMessage } = await this.lib();
    // Baileys' own MediaType union includes "sticker" (stickers are just
    // webp images under the hood) -- same download path as every other
    // media type, not a special case (Part: WhatsApp message-type
    // coverage, 2026-10-29).
    const stream = await downloadContentFromMessage(mediaContent, mediaType);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const buffer = Buffer.concat(chunks);

    const mimeType: string = mediaContent.mimetype ?? "application/octet-stream";
    const extGuess = mimeType.split("/")[1]?.split(";")[0] ?? "bin";
    // Document messages carry the sender's real filename (Baileys'
    // IDocumentMessage.fileName) -- worth keeping for the download button
    // instead of the generic "whatsapp-document.pdf" every other media
    // type gets (which has no equivalent real name to prefer).
    const filename: string = mediaType === "document" && mediaContent.fileName ? mediaContent.fileName : `whatsapp-${mediaType}.${extGuess}`;
    const url = await this.storeMediaAsset(accountId, buffer, mimeType, filename, "whatsapp-inbound");
    return { url, mimeType, filename };
  }

  /** Shared by inbound (downloadAndStoreMedia, above) and outbound
   *  (sendMedia, below) -- saves bytes via the existing MediaStorageService
   *  and creates a MediaAsset row so the result is servable through the
   *  same `/media/:id` route either direction already uses. Reuses
   *  MediaAsset (nominally the Content Library's own model) rather than a
   *  second storage mechanism -- its shape (storageKey/mimeType/sizeBytes)
   *  is generic, not actually Content-Library-specific. */
  private async storeMediaAsset(accountId: string, buffer: Buffer, mimeType: string, filename: string, tag: string): Promise<string> {
    const account = await this.prisma.socialAccount.findUniqueOrThrow({ where: { id: accountId } });
    const saved = await this.storage.save({ buffer, orgId: account.orgId, filename });
    const asset = await this.prisma.mediaAsset.create({
      data: {
        orgId: account.orgId,
        // Always set in practice -- startNewSession always stamps
        // connectedByUserId on a WHATSAPP_QR account. "system" is just a
        // defensive fallback, never a real user id this column would
        // otherwise hold.
        uploadedByUserId: account.connectedByUserId ?? "system",
        filename,
        storageKey: saved.storageKey,
        mimeType,
        sizeBytes: saved.sizeBytes,
        tags: [tag],
      },
    });
    return `/media/${asset.id}`;
  }

  /** `participantId` is a bare phone number (SocialConversation.externalConversationId
   *  for this platform, same shape startConversation's digit-strip already
   *  produces) -- turned into a JID here, not upstream, since nothing else
   *  needs the @s.whatsapp.net suffix. */
  async sendMessage(accountId: string, participantId: string, text: string, senderUser?: { id: string; name: string }): Promise<void> {
    const sock = this.sockets.get(accountId);
    if (!sock) {
      throw new BadRequestException("This WhatsApp number isn't connected right now -- reconnect it from the Numbers tab.");
    }
    const jid = participantId.includes("@") ? participantId : `${participantId}@s.whatsapp.net`;

    const previous = this.sendQueues.get(accountId) ?? Promise.resolve();
    const next = previous.then(async () => {
      const delay = SEND_JITTER_MS[0] + Math.random() * (SEND_JITTER_MS[1] - SEND_JITTER_MS[0]);
      await new Promise((resolve) => setTimeout(resolve, delay));
      await sock.sendPresenceUpdate("composing", jid).catch(() => undefined);
      const sent = await sock.sendMessage(jid, { text });
      // Persisted here, not by the generic SocialInboxService.reply()/
      // startConversation() callers -- WhatsApp echoes every outbound send
      // back to this same socket via messages.upsert (fromMe: true) a
      // moment later, unlike Facebook/Instagram/the Cloud API, which never
      // echo your own sent message back. Using the REAL WhatsApp message id
      // Baileys just returned (not a synthetic one) means that later echo's
      // own persistMessage call hits the existing P2002 dedup and is
      // correctly treated as a no-op, instead of creating a second row for
      // the same logical message (confirmed duplicate bug in production,
      // 2026-10-26 -- every manual reply was showing up twice).
      const account = await this.prisma.socialAccount.findUniqueOrThrow({ where: { id: accountId } });
      await this.ingest.persistMessage(account, {
        externalConversationId: participantId,
        externalMessageId: sent?.key.id || `outbound-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        fromUs: true,
        // Who actually sent this (Part: WhatsApp Team Inbox sender
        // attribution, 2026-10-26) -- SocialInboxService.getConversation
        // strips this back out for anyone who isn't the primary admin
        // before it ever reaches the frontend; stored here regardless so
        // the primary admin can always see it.
        senderName: senderUser?.name,
        messageText: text,
        sentAt: new Date(),
      });
    });
    this.sendQueues.set(accountId, next.catch(() => undefined));
    await next;
  }

  /** Sending a file (Part: WhatsApp Team Inbox media send, 2026-10-26,
   *  explicit user request -- "there is no option to add or attach
   *  anything... make sure i got each and every option that whatsapp
   *  offers" -- scoped down to file attachments, not voice-note
   *  recording, per follow-up). Shares sendMessage's per-account queue
   *  (not a second, independent one) so a text reply and a file attach
   *  from two team members still serialize onto the one socket in
   *  whichever order they were actually clicked, rather than racing. */
  async sendMedia(
    accountId: string,
    participantId: string,
    media: { buffer: Buffer; mimetype: string; filename: string; caption?: string },
    senderUser?: { id: string; name: string },
  ): Promise<void> {
    const sock = this.sockets.get(accountId);
    if (!sock) {
      throw new BadRequestException("This WhatsApp number isn't connected right now -- reconnect it from the Numbers tab.");
    }
    const jid = participantId.includes("@") ? participantId : `${participantId}@s.whatsapp.net`;

    const previous = this.sendQueues.get(accountId) ?? Promise.resolve();
    const next = previous.then(async () => {
      const delay = SEND_JITTER_MS[0] + Math.random() * (SEND_JITTER_MS[1] - SEND_JITTER_MS[0]);
      await new Promise((resolve) => setTimeout(resolve, delay));
      await sock.sendPresenceUpdate("composing", jid).catch(() => undefined);

      // WAMediaUpload accepts a plain Buffer directly -- no need to go
      // through Baileys' own upload-from-URL/stream path since the whole
      // file already arrived in memory via the controller's multipart
      // upload.
      const content = media.mimetype.startsWith("image/")
        ? { image: media.buffer, mimetype: media.mimetype, caption: media.caption }
        : media.mimetype.startsWith("video/")
          ? { video: media.buffer, mimetype: media.mimetype, caption: media.caption }
          : media.mimetype.startsWith("audio/")
            ? { audio: media.buffer, mimetype: media.mimetype } // not ptt -- this is an attached file, not a recorded voice note
            : { document: media.buffer, mimetype: media.mimetype, fileName: media.filename, caption: media.caption };
      const sent = await sock.sendMessage(jid, content);

      const mediaUrl = await this.storeMediaAsset(accountId, media.buffer, media.mimetype, media.filename, "whatsapp-outbound");
      const account = await this.prisma.socialAccount.findUniqueOrThrow({ where: { id: accountId } });
      await this.ingest.persistMessage(account, {
        externalConversationId: participantId,
        externalMessageId: sent?.key.id || `outbound-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        fromUs: true,
        senderName: senderUser?.name,
        messageText: media.caption,
        mediaUrl,
        mediaMimeType: media.mimetype,
        mediaFilename: media.filename,
        sentAt: new Date(),
      });
    });
    this.sendQueues.set(accountId, next.catch(() => undefined));
    await next;
  }

  async logout(accountId: string): Promise<void> {
    const sock = this.sockets.get(accountId);
    if (sock) {
      await sock.logout().catch(() => undefined);
      this.sockets.delete(accountId);
    }
    await this.prisma.whatsAppQrSession.update({
      where: { socialAccountId: accountId },
      data: { status: "LOGGED_OUT", lastDisconnectedAt: new Date(), disconnectReason: "manual_logout" },
    });
    await this.prisma.socialAccount.update({ where: { id: accountId }, data: { status: "DISCONNECTED" } });
    await fs.rm(this.sessionDir(accountId), { recursive: true, force: true }).catch(() => undefined);
  }

  getStatus(accountId: string): "live" | "offline" {
    return this.sockets.has(accountId) ? "live" : "offline";
  }

  /** Re-scans a QR for an existing account that's DISCONNECTED/LOGGED_OUT
   *  (as opposed to startNewSession, which creates a brand-new SocialAccount
   *  row) -- the "this number needs reconnecting" path from the Numbers tab. */
  async reconnectSession(accountId: string, userId: string): Promise<void> {
    this.connectingUsers.set(accountId, userId);
    await this.prisma.whatsAppQrSession.update({ where: { socialAccountId: accountId }, data: { status: "CONNECTING" } });
    await this.connect(accountId).catch((err) => {
      this.logger.error(`WhatsApp QR reconnect failed for account ${accountId}: ${(err as Error).message}`);
      this.connectingUsers.delete(accountId);
    });
  }
}
