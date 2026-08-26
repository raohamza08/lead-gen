import { Controller, Get, Logger, Post, Query, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request, Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { PrismaService } from "../common/prisma/prisma.service";
import { SocialInboxIngestService } from "../social-media/social-inbox-ingest.service";

/** Meta's messaging webhook payload shape -- one callback URL covers both
 *  Facebook Page and Instagram messaging; `object` disambiguates which. */
interface MetaWebhookPayload {
  object: "page" | "instagram" | string;
  entry: {
    id: string;
    time: number;
    messaging?: {
      sender: { id: string };
      recipient: { id: string };
      timestamp: number;
      message?: { mid: string; text?: string; attachments?: { type: string; payload: { url?: string } }[] };
    }[];
  }[];
}

/**
 * Meta's real-time DM webhook (Part: Unified Social Media DM Monitoring).
 * Verified via X-Hub-Signature-256 against META_OAUTH_CLIENT_SECRET (the
 * App Secret Meta signs every webhook payload with -- no separate webhook
 * secret to generate). Needs the exact request bytes, not a re-serialized
 * JSON.stringify(body), so this reads req.rawBody (see main.ts's
 * `rawBody: true`), not the ClickUp webhook's re-stringify shortcut.
 */
@Controller("webhooks/social")
export class SocialWebhookController {
  private readonly logger = new Logger(SocialWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly ingest: SocialInboxIngestService,
  ) {}

  /** Meta's one-time subscription verification handshake. */
  @Get("meta")
  verify(@Query() query: Record<string, string>, @Res() res: Response) {
    const verifyToken = this.config.get<string>("META_WEBHOOK_VERIFY_TOKEN");
    if (query["hub.mode"] === "subscribe" && verifyToken && query["hub.verify_token"] === verifyToken) {
      res.status(200).send(query["hub.challenge"]);
      return;
    }
    res.status(403).send("Verification failed");
  }

  @Post("meta")
  async handle(@Req() req: RawBodyRequest<Request>, @Res() res: Response) {
    // Meta expects a fast 200 regardless of downstream outcome -- a
    // non-200 response makes Meta retry-storm the same batch of events.
    // Real failures are logged, not surfaced back to Meta as an error.
    res.status(200).send("EVENT_RECEIVED");

    const secret = this.config.get<string>("META_OAUTH_CLIENT_SECRET");
    const signatureHeader = req.headers["x-hub-signature-256"] as string | undefined;
    if (!secret || !this.verifyMetaSignature(req.rawBody, signatureHeader, secret)) {
      this.logger.warn("Rejected Meta webhook: invalid or missing signature");
      return;
    }

    let payload: MetaWebhookPayload;
    try {
      payload = JSON.parse((req.rawBody ?? Buffer.from("{}")).toString("utf8"));
    } catch {
      this.logger.warn("Rejected Meta webhook: unparseable body");
      return;
    }

    for (const entry of payload.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        if (!event.message) continue; // read receipts/delivery confirmations etc. -- nothing to persist
        try {
          await this.handleMessagingEvent(payload.object, entry.id, event);
        } catch (err) {
          this.logger.error(`Failed to ingest Meta webhook message: ${(err as Error).message}`);
        }
      }
    }
  }

  private verifyMetaSignature(rawBody: Buffer | undefined, signatureHeader: string | undefined, secret: string): boolean {
    if (!rawBody || !signatureHeader?.startsWith("sha256=")) return false;
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const provided = signatureHeader.slice("sha256=".length);
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async handleMessagingEvent(
    object: string,
    entryId: string,
    event: NonNullable<MetaWebhookPayload["entry"][number]["messaging"]>[number],
  ) {
    const platform = object === "instagram" ? "INSTAGRAM" : "FACEBOOK";
    const socialAccount = await this.prisma.socialAccount.findFirst({
      where: { platform, externalAccountId: entryId, status: "CONNECTED" },
    });
    if (!socialAccount) {
      this.logger.warn(`Meta webhook for unknown/disconnected account ${platform}:${entryId}`);
      return;
    }

    const fromUs = event.sender.id === entryId;
    const conversationParticipantId = fromUs ? event.recipient.id : event.sender.id;

    await this.ingest.persistMessage(socialAccount, {
      externalConversationId: conversationParticipantId,
      contactExternalId: conversationParticipantId,
      externalMessageId: event.message!.mid,
      fromUs,
      messageText: event.message!.text,
      mediaUrl: event.message!.attachments?.[0]?.payload?.url,
      sentAt: new Date(event.timestamp),
    });
  }
}
