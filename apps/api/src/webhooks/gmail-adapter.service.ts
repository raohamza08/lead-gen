import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { GmailProvider } from "../email/providers/gmail.provider";

export interface NormalizedInboundEvent {
  eventType: "REPLIED" | "BOUNCED";
  leadEmail?: string;
}

interface GmailPubSubPush {
  message: { data: string; messageId: string; publishTime: string };
  subscription: string;
}

/**
 * Translates a Gmail Cloud Pub/Sub push notification into normalized inbound
 * events (Part E2 `/webhooks/gmail`). Pub/Sub only carries `{emailAddress,
 * historyId}` — the actual change has to be fetched via `users.history.list`
 * against the cursor stored on the account (Part C6 reply-detection).
 *
 * Bounce detection here is a heuristic (From: mailer-daemon/postmaster), not a
 * full NDR parse — good enough to flag a bounce for the suppression list, not
 * precise enough to always resolve back to the specific EmailMessage that
 * bounced. That mapping is left to the caller.
 */
@Injectable()
export class GmailAdapterService {
  private readonly logger = new Logger(GmailAdapterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gmailProvider: GmailProvider,
  ) {}

  async translate(push: GmailPubSubPush): Promise<NormalizedInboundEvent[]> {
    let decoded: { emailAddress?: string; historyId?: string | number };
    try {
      decoded = JSON.parse(Buffer.from(push.message.data, "base64").toString("utf8"));
    } catch {
      this.logger.warn("Failed to decode Gmail Pub/Sub push payload");
      return [];
    }
    if (!decoded.emailAddress) return [];

    const account = await this.prisma.emailAccount.findUnique({ where: { address: decoded.emailAddress } });
    if (!account) return [];

    const gmail = this.gmailProvider.getAuthenticatedClient(account);
    if (!gmail) {
      this.logger.warn(`Gmail not configured for account ${account.address} — cannot resolve push notification`);
      return [];
    }

    const startHistoryId = account.lastHistoryId ?? String(decoded.historyId);
    const history = await gmail.users.history.list({
      userId: "me",
      startHistoryId,
      historyTypes: ["messageAdded"],
    });

    const events: NormalizedInboundEvent[] = [];
    for (const item of history.data.history ?? []) {
      for (const added of item.messagesAdded ?? []) {
        const messageId = added.message?.id;
        if (!messageId) continue;

        const msg = await gmail.users.messages.get({
          userId: "me",
          id: messageId,
          format: "metadata",
          metadataHeaders: ["From"],
        });
        const fromHeader = msg.data.payload?.headers?.find((h) => h.name?.toLowerCase() === "from")?.value ?? "";
        const fromEmail = fromHeader.match(/<(.+)>/)?.[1] ?? fromHeader;
        if (!fromEmail) continue;

        const isBounce = /mailer-daemon|postmaster/i.test(fromHeader);
        events.push({ eventType: isBounce ? "BOUNCED" : "REPLIED", leadEmail: isBounce ? undefined : fromEmail });
      }
    }

    await this.prisma.emailAccount.update({
      where: { id: account.id },
      data: { lastHistoryId: String(history.data.historyId ?? decoded.historyId ?? "") },
    });

    return events;
  }
}
