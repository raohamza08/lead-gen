import { BadRequestException, Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import * as path from "path";
import { promises as fs } from "fs";
import * as QRCode from "qrcode";
import type { WASocket, WAMessage, ConnectionState } from "@whiskeysockets/baileys";
import { PrismaService } from "../../common/prisma/prisma.service";
import { RealtimeGateway } from "../../realtime/realtime.gateway";
import { SocialInboxIngestService } from "../social-inbox-ingest.service";
import { MEDIA_STORAGE_SERVICE, MediaStorageService } from "../media/media-storage.interface";

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
  private baileys?: BaileysModule;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly ingest: SocialInboxIngestService,
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

  async startNewSession(orgId: string, userId: string, label: string): Promise<{ accountId: string }> {
    const account = await this.prisma.socialAccount.create({
      data: {
        orgId,
        platform: "WHATSAPP_QR",
        username: label,
        displayName: label,
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

  async connect(accountId: string): Promise<void> {
    if (this.sockets.has(accountId)) return;
    const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = await this.lib();
    const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir(accountId));
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({ auth: state, version, syncFullHistory: false });
    this.sockets.set(accountId, sock);

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (update) => this.handleConnectionUpdate(accountId, update));
    sock.ev.on("messages.upsert", ({ messages }) => {
      for (const message of messages) {
        this.ingestMessage(accountId, message).catch((err) =>
          this.logger.error(`Failed to ingest WhatsApp message on account ${accountId}: ${(err as Error).message}`),
        );
      }
    });
  }

  private async handleConnectionUpdate(accountId: string, update: Partial<ConnectionState>) {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      await this.prisma.whatsAppQrSession.update({
        where: { socialAccountId: accountId },
        data: { status: "QR_PENDING", lastQrAt: new Date() },
      });
      const requestingUserId = this.connectingUsers.get(accountId);
      if (requestingUserId) {
        const qrDataUrl = await QRCode.toDataURL(qr);
        this.realtime.emitToUser(requestingUserId, "whatsappQr.qr", { accountId, qrDataUrl });
      }
    }

    if (connection === "open") {
      const sock = this.sockets.get(accountId);
      const phoneNumber = sock?.user?.id?.split(":")[0];
      const account = await this.prisma.socialAccount.update({
        where: { id: accountId },
        data: { status: "CONNECTED", externalAccountId: phoneNumber, connectedAt: new Date() },
      });
      await this.prisma.whatsAppQrSession.update({
        where: { socialAccountId: accountId },
        data: { status: "CONNECTED", lastConnectedAt: new Date(), disconnectReason: null },
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

      if (statusCode === DisconnectReason.loggedOut) {
        await this.prisma.whatsAppQrSession.update({
          where: { socialAccountId: accountId },
          data: { status: "LOGGED_OUT", lastDisconnectedAt: new Date(), disconnectReason: "logged_out" },
        });
        await this.prisma.socialAccount.update({ where: { id: accountId }, data: { status: "DISCONNECTED" } });
        await fs.rm(this.sessionDir(accountId), { recursive: true, force: true }).catch(() => undefined);
        const requestingUserId = this.connectingUsers.get(accountId);
        if (requestingUserId) this.realtime.emitToUser(requestingUserId, "whatsappQr.loggedOut", { accountId });
        this.connectingUsers.delete(accountId);
      } else {
        // Anything other than an explicit logout is left for
        // WhatsAppQrReconnectWorker's sweep to retry with backoff, not
        // retried inline here -- a flaky network blip shouldn't become an
        // unbounded retry loop on this same event handler.
        await this.prisma.whatsAppQrSession.update({
          where: { socialAccountId: accountId },
          data: { status: "DISCONNECTED", lastDisconnectedAt: new Date(), disconnectReason: String(statusCode ?? "unknown") },
        });
        const requestingUserId = this.connectingUsers.get(accountId);
        if (requestingUserId) {
          this.realtime.emitToUser(requestingUserId, "whatsappQr.disconnected", { accountId });
          this.connectingUsers.delete(accountId);
        }
      }
    }
  }

  private async ingestMessage(accountId: string, message: WAMessage): Promise<void> {
    const remoteJid = message.key.remoteJid;
    if (!remoteJid || remoteJid.endsWith("@g.us") || remoteJid === "status@broadcast") return; // groups/status not in scope
    if (!message.message) return; // protocol/reaction-only messages carry no content worth persisting

    const contactNumber = remoteJid.split("@")[0];
    // Baileys' protobuf-generated message types are a deep tree of optional
    // fields with no shared base -- read loosely here rather than fighting
    // the exact union of IImageMessage/IVideoMessage/IAudioMessage/
    // IDocumentMessage, same pragmatic looseness their own examples use.
    const content = message.message as Record<string, any>;
    const mediaContent: Record<string, any> | undefined = content.imageMessage ?? content.videoMessage ?? content.audioMessage ?? content.documentMessage;
    const mediaType: "image" | "video" | "audio" | "document" | undefined = content.imageMessage
      ? "image"
      : content.videoMessage
        ? "video"
        : content.audioMessage
          ? "audio"
          : content.documentMessage
            ? "document"
            : undefined;

    const text =
      content.conversation ??
      content.extendedTextMessage?.text ??
      mediaContent?.caption ??
      (mediaType ? `[${mediaType}]` : undefined);

    let mediaUrl: string | undefined;
    if (mediaContent && mediaType) {
      mediaUrl = await this.downloadAndStoreMedia(accountId, mediaContent, mediaType).catch((err) => {
        this.logger.error(`Failed to download WhatsApp ${mediaType} for account ${accountId}: ${(err as Error).message}`);
        return undefined;
      });
    }
    if (!text && !mediaUrl) return;

    const account = await this.prisma.socialAccount.findUniqueOrThrow({ where: { id: accountId } });
    await this.ingest.persistMessage(account, {
      externalConversationId: contactNumber,
      contactExternalId: contactNumber,
      contactUsername: contactNumber,
      contactName: message.pushName || undefined,
      externalMessageId: message.key.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      fromUs: Boolean(message.key.fromMe),
      messageText: text,
      mediaUrl,
      sentAt: message.messageTimestamp ? new Date(Number(message.messageTimestamp) * 1000) : new Date(),
    });
  }

  private async downloadAndStoreMedia(
    accountId: string,
    mediaContent: Record<string, any>,
    mediaType: "image" | "video" | "audio" | "document",
  ): Promise<string> {
    const { downloadContentFromMessage } = await this.lib();
    const stream = await downloadContentFromMessage(mediaContent, mediaType);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const buffer = Buffer.concat(chunks);

    const account = await this.prisma.socialAccount.findUniqueOrThrow({ where: { id: accountId } });
    const mimeType: string = mediaContent.mimetype ?? "application/octet-stream";
    const extGuess = mimeType.split("/")[1]?.split(";")[0] ?? "bin";
    const filename = `whatsapp-${mediaType}.${extGuess}`;

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
        tags: ["whatsapp-inbound"],
      },
    });
    return `/media/${asset.id}`;
  }

  /** `participantId` is a bare phone number (SocialConversation.externalConversationId
   *  for this platform, same shape startConversation's digit-strip already
   *  produces) -- turned into a JID here, not upstream, since nothing else
   *  needs the @s.whatsapp.net suffix. */
  async sendMessage(accountId: string, participantId: string, text: string): Promise<void> {
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
      await sock.sendMessage(jid, { text });
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
