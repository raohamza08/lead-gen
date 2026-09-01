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

/** A pixel fetch inside this window after sending is never a genuine open —
 *  it's a proxy/scanner prefetch or the sender's own mail client rendering
 *  a send-confirmation preview (Part: 3-minute open verification,
 *  2026-09-01). Every fetch is still recorded as a raw event regardless;
 *  this only gates whether it becomes a *verified* open. */
const OPEN_VERIFICATION_WINDOW_MS = 180_000;

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
   * Every real pixel fetch is recorded as a raw EmailEvent{OPENED} row
   * unconditionally — this is the one place that event is ever written (no
   * send/queue/deliver path writes one), so there is no way for a false
   * "opened" signal to originate from anywhere else. But a raw fetch only
   * becomes a *verified* open — the one thing the UI, notifications, and
   * analytics actually read — if it happens at least
   * OPEN_VERIFICATION_WINDOW_MS after the message's `sentAt` (Part: 3-minute
   * open verification, 2026-09-01): an immediate hit is a proxy/scanner
   * prefetch or a send-confirmation preview, not a person reading the email.
   *
   * The `updateMany` with `verifiedOpenedAt: null` in its WHERE clause is
   * what makes "am I the first request to verify this" race-safe — two
   * near-simultaneous valid fetches can't both fire the notification, only
   * whichever one's UPDATE actually flips the row gets `count > 0`.
   */
  @Get("track/open/:emailMessageId.png")
  async trackOpen(@Param("emailMessageId") emailMessageId: string, @Res() res: Response) {
    try {
      const message = await this.prisma.emailMessage.findUnique({
        where: { id: emailMessageId },
        include: { lead: { select: { orgId: true, companyName: true } } },
      });
      if (message) {
        const now = new Date();
        await this.prisma.emailEvent.create({ data: { messageId: emailMessageId, eventType: "OPENED", occurredAt: now } });

        const elapsedMs = message.sentAt ? now.getTime() - message.sentAt.getTime() : null;
        const isValidOpen = elapsedMs !== null && elapsedMs >= OPEN_VERIFICATION_WINDOW_MS;

        if (isValidOpen && !message.verifiedOpenedAt) {
          const result = await this.prisma.emailMessage.updateMany({
            where: { id: emailMessageId, verifiedOpenedAt: null },
            data: { verifiedOpenedAt: now },
          });
          if (result.count > 0) {
            this.realtime.emitToOrg(message.lead.orgId, "email.opened", {
              leadId: message.leadId,
              emailMessageId,
              openedAt: now.toISOString(),
            });
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
      }
    } catch {
      // unknown message id (or a race on a since-deleted lead) — do not
      // error the pixel response, the image must still render either way.
    }
    res.set("Content-Type", "image/gif").send(TRACKING_PIXEL);
  }

  /** Hub compose/reply's tracking counterpart — see HubEmailOpenTracking's
   *  schema docblock for why this is a separate, minimal mechanism instead
   *  of reusing EmailMessage (which requires a Lead). Same 3-minute
   *  verification rule as trackOpen above; `rawOpenCount` stands in for the
   *  EmailEvent log outreach tracking has (Hub tracking has no per-event
   *  table), so "raw vs. verified" is still distinguishable here. */
  @Get("track/open/hub/:trackingId.png")
  async trackHubOpen(@Param("trackingId") trackingId: string, @Res() res: Response) {
    try {
      const row = await this.prisma.hubEmailOpenTracking.findUnique({ where: { id: trackingId } });
      if (row) {
        const now = new Date();
        await this.prisma.hubEmailOpenTracking.update({
          where: { id: trackingId },
          data: { rawOpenCount: { increment: 1 }, openedAt: row.openedAt ?? now },
        });

        const elapsedMs = now.getTime() - row.sentAt.getTime();
        const isValidOpen = elapsedMs >= OPEN_VERIFICATION_WINDOW_MS;

        if (isValidOpen && !row.verifiedOpenedAt) {
          const result = await this.prisma.hubEmailOpenTracking.updateMany({
            where: { id: trackingId, verifiedOpenedAt: null },
            data: { verifiedOpenedAt: now },
          });
          if (result.count > 0) {
            this.realtime.emitToOrg(row.orgId, "email.opened", { hubTrackingId: trackingId, openedAt: now.toISOString() });
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
        }
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
