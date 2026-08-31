import { Body, Controller, Post } from "@nestjs/common";
import { NotificationCategory, Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { SequencerService } from "../sequencer/sequencer.service";
import { SyncService } from "../sync/sync.service";
import { EmailEventType, PipelineStage } from "@leadgen/types";
import { GmailAdapterService } from "./gmail-adapter.service";
import { GraphAdapterService } from "./graph-adapter.service";
import { NotificationsService } from "../notifications/notifications.service";

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
    private readonly notifications: NotificationsService,
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

  /**
   * Reply detection short-circuits the whole sequence (Part C6) — cancel any
   * pending wait timer immediately.
   *
   * Also records an EmailEvent{REPLIED} against whichever message this lead
   * most recently received — without it, reply rate has no row to count:
   * analytics.service.ts's getEmailFunnel counts REPLIED strictly from
   * email_events, and every path into this method (the generic
   * /email-events ingest, Gmail, and Graph) previously only updated
   * PipelineState, so replyRate has been silently stuck at 0% however many
   * real replies came in. The most-recently-SENT message is the one being
   * replied to; a lead with none yet (replied before any send somehow
   * recorded) has nothing to attach the event to, so that case is skipped
   * rather than guessed.
   */
  private async handleReply(leadEmail: string) {
    const lead = await this.prisma.lead.findFirst({ where: { email: leadEmail } });
    if (!lead) return { ignored: true, reason: "unknown recipient" };

    const lastSent = await this.prisma.emailMessage.findFirst({
      where: { leadId: lead.id, status: "SENT" },
      orderBy: { sentAt: "desc" },
    });
    if (lastSent) {
      await this.prisma.emailEvent.create({
        data: { messageId: lastSent.id, eventType: "REPLIED" },
      });
    }

    await this.sequencer.cancelWaitTimer(lead.id);
    await this.prisma.pipelineState.update({
      where: { leadId: lead.id },
      data: { stage: PipelineStage.REPLIED, enteredStageAt: new Date() },
    });
    await this.sync.onStageChanged(lead.id, PipelineStage.REPLIED);

    // A genuine reply is the one stage change worth a notification — every
    // other automated hop (WAITING_EMAIL_N, EMAIL_N_SENT) is routine
    // automation progress, not something a salesperson needs pinged about.
    await this.notifications.notify(lead.orgId, {
      category: NotificationCategory.LEADS,
      type: "LEAD_REPLIED",
      severity: "WARNING",
      title: "Lead Replied",
      message: `${lead.companyName ?? "A lead"} replied to your outreach.`,
      leadId: lead.id,
      actionUrl: `/leads/${lead.id}`,
    });

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
