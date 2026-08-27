import { Controller, Get, Logger, Post, Query, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request, Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { PrismaService } from "../common/prisma/prisma.service";
import { SocialInboxIngestService } from "../social-media/social-inbox-ingest.service";

/** Meta's messaging webhook payload shape -- one callback URL covers
 *  Facebook Page, Instagram, and WhatsApp messaging; `object` disambiguates
 *  which. WhatsApp's shape (changes[].value.messages[]) is genuinely
 *  different from Messenger/Instagram's (messaging[]), not just a renamed
 *  field -- handled as a separate branch below rather than forced into the
 *  same parsing path. */
interface MetaWebhookPayload {
  object: "page" | "instagram" | "whatsapp_business_account" | string;
  entry: {
    id: string;
    time: number;
    messaging?: {
      sender: { id: string };
      recipient: { id: string };
      timestamp: number;
      message?: { mid: string; text?: string; attachments?: { type: string; payload: { url?: string } }[] };
    }[];
    changes?: {
      field: string;
      value: {
        metadata?: { phone_number_id: string };
        contacts?: { profile?: { name?: string }; wa_id: string }[];
        messages?: {
          from: string;
          id: string;
          timestamp: string;
          type: string;
          text?: { body: string };
        }[];
      };
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
      if (payload.object === "whatsapp_business_account") {
        for (const change of entry.changes ?? []) {
          if (change.field !== "messages") continue; // template status updates etc. -- nothing to persist
          for (const message of change.value.messages ?? []) {
            try {
              await this.handleWhatsAppMessage(change.value, message);
            } catch (err) {
              this.logger.error(`Failed to ingest WhatsApp webhook message: ${(err as Error).message}`);
            }
          }
        }
        continue;
      }
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

  /** WhatsApp's `messages` field only ever carries genuinely inbound
   *  customer messages (fromUs is always false here) -- our own sent
   *  replies are persisted directly by SocialInboxService.reply() at send
   *  time, the same way Facebook/Instagram's reply path already works, not
   *  echoed back through this webhook the way Messenger's is. Resolved by
   *  metadata.phone_number_id, not entry.id -- entry.id is the WABA id,
   *  which SocialAccount.externalAccountId does not store (see
   *  WhatsAppProvider's docblock). */
  private async handleWhatsAppMessage(
    value: NonNullable<NonNullable<MetaWebhookPayload["entry"][number]["changes"]>[number]["value"]>,
    message: NonNullable<typeof value.messages>[number],
  ) {
    const phoneNumberId = value.metadata?.phone_number_id;
    if (!phoneNumberId) return;
    const socialAccount = await this.prisma.socialAccount.findFirst({
      where: { platform: "WHATSAPP", externalAccountId: phoneNumberId, status: "CONNECTED" },
    });
    if (!socialAccount) {
      this.logger.warn(`WhatsApp webhook for unknown/disconnected phone number ${phoneNumberId}`);
      return;
    }

    const contact = value.contacts?.find((c) => c.wa_id === message.from);
    await this.ingest.persistMessage(socialAccount, {
      externalConversationId: message.from,
      contactExternalId: message.from,
      contactName: contact?.profile?.name,
      externalMessageId: message.id,
      fromUs: false,
      messageText: message.type === "text" ? message.text?.body : `[${message.type} message]`,
      sentAt: new Date(Number(message.timestamp) * 1000),
    });
  }
}
