import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import { Response } from "express";
import { PrismaService } from "../common/prisma/prisma.service";
import { SequencerService } from "../sequencer/sequencer.service";
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
  ) {}

  @Get("track/open/:emailMessageId.png")
  async trackOpen(@Param("emailMessageId") emailMessageId: string, @Res() res: Response) {
    await this.prisma.emailEvent
      .create({ data: { messageId: emailMessageId, eventType: "OPENED" } })
      .catch(() => undefined); // unknown message id — do not error the pixel response
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
