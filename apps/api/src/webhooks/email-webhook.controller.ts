import { Body, Controller, Post } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { SequencerService } from "../sequencer/sequencer.service";
import { SyncService } from "../sync/sync.service";
import { EmailEventType, PipelineStage } from "@leadgen/types";
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
    private readonly sync: SyncService,
    private readonly gmailAdapter: GmailAdapterService,
    private readonly graphAdapter: GraphAdapterService,
  ) {}

  @Post("email-events")
  async ingest(@Body() payload: InboundEventPayload) {
    if (payload.eventType === "REPLIED" && payload.leadEmail) {
      return this.handleReply(payload.leadEmail);
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
        await this.handleReply(event.leadEmail);
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
        await this.handleReply(event.leadEmail);
      }
    }
    return { ok: true, translated: events.length };
  }

  /** Reply detection short-circuits the whole sequence (Part C6) — cancel any pending wait timer immediately. */
  private async handleReply(leadEmail: string) {
    const lead = await this.prisma.lead.findFirst({ where: { email: leadEmail } });
    if (!lead) return { ignored: true, reason: "unknown recipient" };

    await this.sequencer.cancelWaitTimer(lead.id);
    await this.prisma.pipelineState.update({
      where: { leadId: lead.id },
      data: { stage: PipelineStage.REPLIED, enteredStageAt: new Date() },
    });
    await this.sync.onStageChanged(lead.id, PipelineStage.REPLIED);
    return { ok: true };
  }

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
  }
}
