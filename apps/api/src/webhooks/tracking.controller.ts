import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import { Response } from "express";
import { NotificationCategory } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { SequencerService } from "../sequencer/sequencer.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { NotificationsService } from "../notifications/notifications.service";
import { dashboardUrl } from "../common/cors";

// 1x1 transparent GIF, served for open tracking.
const TRACKING_PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7",
  "base64",
);

/**
 * Open/click tracking + unsubscribe (Part C6/G1 CAN-SPAM requirement: the
 * unsubscribe link must actually work and be honored immediately, not just be
 * present as copy). These are public, unauthenticated-by-design endpoints —
 * they only ever write EmailEvent rows or a SuppressionEntry, never leak PII
 * back in the response.
 */
@Controller()
export class TrackingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequencer: SequencerService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Fires ONLY on an actual pixel fetch — this is the one place an OPENED
   * event is ever written (no send/queue/deliver path writes one), so there
   * is no way for a false "opened" notification to occur. Notifies once per
   * message (a mail client re-fetching the pixel on scroll/reopen must not
   * re-notify) by checking whether this is the first OPENED row for it
   * (Part: reliability overhaul, 2026-08-31 — previously no notification
   * fired on a real open at all, only an EmailEvent row for analytics).
   */
  @Get("track/open/:emailMessageId.png")
  async trackOpen(@Param("emailMessageId") emailMessageId: string, @Res() res: Response) {
    try {
      await this.prisma.emailEvent.create({ data: { messageId: emailMessageId, eventType: "OPENED" } });
      const priorOpens = await this.prisma.emailEvent.count({
        where: { messageId: emailMessageId, eventType: "OPENED" },
      });
      if (priorOpens === 1) {
        const message = await this.prisma.emailMessage.findUnique({
          where: { id: emailMessageId },
          include: { lead: { select: { orgId: true, companyName: true } } },
        });
        if (message) {
          this.realtime.emitToOrg(message.lead.orgId, "email.opened", { leadId: message.leadId, emailMessageId });
          await this.notifications.notify(message.lead.orgId, {
            category: NotificationCategory.EMAIL,
            type: "EMAIL_OPENED",
            severity: "WARNING",
            title: "Email Opened",
            message: `${message.lead.companyName ?? "A lead"} opened email ${message.sequenceStep}`,
            leadId: message.leadId,
            entityType: "emailMessage",
            entityId: message.id,
            actionUrl: `/leads/${message.leadId}`,
          });
        }
      }
    } catch {
      // unknown message id (or a race on a since-deleted lead) — do not
      // error the pixel response, the image must still render either way.
    }
    res.set("Content-Type", "image/gif").send(TRACKING_PIXEL);
  }

  /** Hub compose/reply's tracking counterpart — see HubEmailOpenTracking's
   *  schema docblock for why this is a separate, minimal mechanism instead
   *  of reusing EmailMessage (which requires a Lead). */
  @Get("track/open/hub/:trackingId.png")
  async trackHubOpen(@Param("trackingId") trackingId: string, @Res() res: Response) {
    try {
      const row = await this.prisma.hubEmailOpenTracking.findUnique({ where: { id: trackingId } });
      if (row && !row.openedAt) {
        await this.prisma.hubEmailOpenTracking.update({ where: { id: trackingId }, data: { openedAt: new Date() } });
        this.realtime.emitToOrg(row.orgId, "email.opened", { hubTrackingId: trackingId });
        await this.notifications.notify(row.orgId, {
          category: NotificationCategory.EMAIL,
          type: "EMAIL_OPENED",
          severity: "WARNING",
          title: "Email Opened",
          message: `${row.toAddress} opened "${row.subject}"`,
          entityType: "hubEmailOpenTracking",
          entityId: trackingId,
          actionUrl: "/email-hub?view=sent",
        });
      }
    } catch {
      // unknown tracking id — do not error the pixel response.
    }
    res.set("Content-Type", "image/gif").send(TRACKING_PIXEL);
  }

  @Get("track/click/:emailMessageId")
  async trackClick(
    @Param("emailMessageId") emailMessageId: string,
    @Query("to") to: string,
    @Res() res: Response,
  ) {
    await this.prisma.emailEvent
      .create({ data: { messageId: emailMessageId, eventType: "CLICKED", meta: { to } } })
      .catch(() => undefined);
    // `to` is always populated in practice (the real link the email pointed
    // to) — this fallback only fires if that query param is somehow missing,
    // and previously used the raw multi-origin APP_BASE_URL directly, which
    // produces a single malformed URL with a literal comma in it whenever
    // more than one origin is configured. dashboardUrl() is the fix — same
    // bug, same fix, as the unsubscribe redirect below.
    res.redirect(to || dashboardUrl());
  }

  @Get("unsubscribe")
  async unsubscribe(@Query("lead") leadId: string, @Res() res: Response) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (lead?.email) {
      await this.prisma.suppressionEntry.upsert({
        where: { orgId_email: { orgId: lead.orgId, email: lead.email } },
        create: { orgId: lead.orgId, email: lead.email, reason: "UNSUBSCRIBED" },
        update: {},
      });
      await this.sequencer.cancelWaitTimer(leadId);
    }
    res.redirect(`${dashboardUrl()}/unsubscribed`);
  }
}
