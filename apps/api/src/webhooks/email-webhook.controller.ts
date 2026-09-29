import { Body, Controller, Post } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { SequencerService } from "../sequencer/sequencer.service";
import { LeadsService } from "../leads/leads.service";
import { EmailEventType } from "@leadgen/types";
import { GmailAdapterService } from "./gmail-adapter.service";
import { GraphAdapterService } from "./graph-adapter.service";

interface InboundEventPayload {
  emailMessageId?: string;
  leadEmail?: string;
  eventType: "DELIVERED" | "BOUNCED" | "SPAM_COMPLAINT" | "REPLIED";
  meta?: Record<string, unknown>;
}

/**
 * Receives delivery/bounce/complaint/reply signals (Part C6/G6). The
 * `/email-events` endpoint accepts the normalized shape directly (used by
 * anything that already knows an emailMessageId, e.g. internal testing). The
 * `/gmail` and `/graph` endpoints accept each provider's native push/change-
 * notification payload and translate it via GmailAdapterService /
 * GraphAdapterService before running it through the same ingest logic.
 */
@Controller("webhooks")
export class EmailWebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequencer: SequencerService,
    private readonly leads: LeadsService,
    private readonly gmailAdapter: GmailAdapterService,
    private readonly graphAdapter: GraphAdapterService,
  ) {}

  @Post("email-events")
  async ingest(@Body() payload: InboundEventPayload) {
    if (payload.eventType === "REPLIED" && payload.leadEmail) {
      return this.sequencer.recordReply(payload.leadEmail);
    }

    if (payload.emailMessageId) {
      await this.prisma.emailEvent.create({
        data: {
          messageId: payload.emailMessageId,
          eventType: payload.eventType as EmailEventType,
          meta: (payload.meta ?? {}) as Prisma.InputJsonValue,
        },
      });

      if (payload.eventType === "BOUNCED" || payload.eventType === "SPAM_COMPLAINT") {
        await this.addToSuppressionList(payload.emailMessageId, payload.eventType);
      }
    }

    return { ok: true };
  }

  /** Gmail Cloud Pub/Sub push subscription target. */
  @Post("gmail")
  async ingestGmail(@Body() payload: Parameters<GmailAdapterService["translate"]>[0]) {
    const events = await this.gmailAdapter.translate(payload);
    for (const event of events) {
      if (event.eventType === "REPLIED" && event.leadEmail) {
        await this.sequencer.recordReply(event.leadEmail);
      } else {
        // Bounce without a resolvable emailMessageId — no EmailEvent row to attach
        // it to, so this stays a log-only signal rather than a fabricated one.
        // eslint-disable-next-line no-console
        console.warn("Gmail adapter reported a bounce it could not map to an EmailMessage");
      }
    }
    return { ok: true, translated: events.length };
  }

  /** Microsoft Graph change-notification subscription target. */
  @Post("graph")
  async ingestGraph(@Body() payload: Parameters<GraphAdapterService["translate"]>[0]) {
    const events = await this.graphAdapter.translate(payload);
    for (const event of events) {
      if (event.eventType === "REPLIED" && event.leadEmail) {
        await this.sequencer.recordReply(event.leadEmail);
      }
    }
    return { ok: true, translated: events.length };
  }

  /**
   * A hard bounce or spam complaint is as permanent an opt-out as a clicked
   * Unsubscribe link — the lead is deleted the same way (Part:
   * delete-on-unsubscribe, extended 2026-09-29 to cover this path too,
   * explicit user request: a suppressed lead was still sitting in Sequences
   * — visible in the send queue/pending-approvals lists, permanently
   * blocked from ever actually sending — because only the unsubscribe-link
   * handler deleted the lead; this webhook path never did). The
   * SuppressionEntry is written first and unconditionally, same ordering
   * guarantee as the unsubscribe path, so the opt-out survives regardless of
   * whether the delete itself succeeds.
   */
  private async addToSuppressionList(emailMessageId: string, reason: "BOUNCED" | "SPAM_COMPLAINT") {
    const message = await this.prisma.emailMessage.findUnique({
      where: { id: emailMessageId },
      include: { lead: true },
    });
    if (!message?.lead.email) return;
    await this.prisma.suppressionEntry.upsert({
      where: { orgId_email: { orgId: message.lead.orgId, email: message.lead.email } },
      create: {
        orgId: message.lead.orgId,
        email: message.lead.email,
        reason: reason === "BOUNCED" ? "HARD_BOUNCE" : "SPAM_COMPLAINT",
      },
      update: {},
    });
    // TODO(Part I4): if this pushes the sending account's rolling bounce/complaint
    // rate over threshold (~5% / ~0.1%), auto-pause that EmailAccount here rather
    // than only alerting — see Part I4 for why alerting alone is insufficient.
    try {
      await this.leads.remove(message.lead.orgId, message.lead.id);
    } catch {
      // The suppression entry above already guarantees no future send —
      // a failed delete (e.g. already removed) must never break webhook
      // ingest, which the provider expects to ack quickly regardless.
    }
  }
}
