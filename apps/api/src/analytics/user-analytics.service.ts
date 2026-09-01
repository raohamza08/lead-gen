import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { DateRangeName, ResolvedDateRange, resolveDateRange } from "./date-range";
import { buildEmailPerformanceRates } from "./unique-rate";
import { classifySendFailure, SEND_FAILURE_CATEGORY_LABELS, SendFailureCategory } from "./failure-classifier";

export interface EmailPerformanceReport {
  sent: number;
  delivered: number;
  uniqueLeadsOpened: number;
  uniqueLeadsReplied: number;
  failed: number;
  bounced: number;
  openRate: number;
  replyRate: number;
  failureRate: number;
}

/**
 * Lead-upload and email-sending attribution reporting (Part: Lead Upload
 * Analytics / Email Performance / Ignore Groups, 2026-09-01) — kept
 * separate from AnalyticsService (pipeline/funnel/AI-insight reporting,
 * already 585 lines) since this is a distinct concern: who uploaded what,
 * and how the emails tied to that upload performed, over a caller-chosen
 * date range, per requirement #29 ("do not calculate historical statistics
 * from current status alone — use persistent event records").
 *
 * Every count here reads EmailEvent/EmailMessage.verifiedOpenedAt directly,
 * the same authoritative sources AnalyticsService.getEmailFunnel already
 * uses — never PipelineStage/status alone. "Leads Uploaded" always means
 * `Lead.uploadedByUserId IS NOT NULL` — an AI-discovered lead (niche
 * filter/extraction run) was never uploaded by anyone and is intentionally
 * absent from every metric in this service, per the confirmed attribution
 * rule (see the plan's Context section).
 */
@Injectable()
export class UserAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  resolveRange(range: DateRangeName, customFrom?: string, customTo?: string): ResolvedDateRange {
    return resolveDateRange(range, new Date(), customFrom, customTo);
  }

  /** Total leads uploaded in the range — org-wide, or scoped to one uploader. */
  async getLeadUploadStats(orgId: string, { from, to }: ResolvedDateRange, userId?: string): Promise<{ total: number }> {
    const total = await this.prisma.lead.count({
      where: {
        orgId,
        uploadedByUserId: userId ?? { not: null },
        createdAt: { gte: from, lte: to },
      },
    });
    return { total };
  }

  /**
   * Sent/delivered/verified-opened/replied/failed/bounced for the range,
   * each anchored to its OWN event's timestamp (an "Opens today" tile means
   * opens that happened today, regardless of when the email was originally
   * sent — the same convention every ESP dashboard uses, and the one that
   * makes daily trend charts meaningful). `userId`, when given, scopes to
   * emails on leads that user uploaded.
   */
  async getEmailPerformance(orgId: string, { from, to }: ResolvedDateRange, userId?: string): Promise<EmailPerformanceReport> {
    const userFilter = userId ? Prisma.sql`AND l.uploaded_by_user_id = ${userId}` : Prisma.empty;

    const [sentRow] = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM email_messages m
      JOIN leads l ON l.id = m.lead_id
      WHERE l.org_id = ${orgId} AND m.sent_at IS NOT NULL AND m.sent_at BETWEEN ${from} AND ${to} ${userFilter}
    `;
    const [deliveredRow] = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM email_events e
      JOIN email_messages m ON m.id = e.message_id
      JOIN leads l ON l.id = m.lead_id
      WHERE l.org_id = ${orgId} AND e.event_type = 'DELIVERED' AND e.occurred_at BETWEEN ${from} AND ${to} ${userFilter}
    `;
    // Verified-open convention (Part: 3-minute open verification,
    // 2026-09-01) — verifiedOpenedAt, never a raw EmailEvent{OPENED} row,
    // which can include prefetch hits inside the 3-minute window.
    const [openedRow] = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT m.lead_id) AS count FROM email_messages m
      JOIN leads l ON l.id = m.lead_id
      WHERE l.org_id = ${orgId} AND m.verified_opened_at IS NOT NULL AND m.verified_opened_at BETWEEN ${from} AND ${to} ${userFilter}
    `;
    const [repliedRow] = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT l.id) AS count FROM email_events e
      JOIN email_messages m ON m.id = e.message_id
      JOIN leads l ON l.id = m.lead_id
      WHERE l.org_id = ${orgId} AND e.event_type = 'REPLIED' AND e.occurred_at BETWEEN ${from} AND ${to} ${userFilter}
    `;
    const [bouncedRow] = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM email_events e
      JOIN email_messages m ON m.id = e.message_id
      JOIN leads l ON l.id = m.lead_id
      WHERE l.org_id = ${orgId} AND e.event_type = 'BOUNCED' AND e.occurred_at BETWEEN ${from} AND ${to} ${userFilter}
    `;
    // EmailEvent{FAILED} (written only on a TERMINAL failure — see
    // SendingWorker.onSendFailed/SequencerService.resendFailedMessage), not
    // EmailMessage.status/createdAt: a transient attempt that succeeds on
    // retry must never count, and createdAt (when drafted) can be long
    // before the send was actually attempted and failed.
    const [failedRow] = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM email_events e
      JOIN email_messages m ON m.id = e.message_id
      JOIN leads l ON l.id = m.lead_id
      WHERE l.org_id = ${orgId} AND e.event_type = 'FAILED' AND e.occurred_at BETWEEN ${from} AND ${to} ${userFilter}
    `;
    const failed = Number(failedRow?.count ?? 0);

    const counts = {
      sent: Number(sentRow?.count ?? 0),
      delivered: Number(deliveredRow?.count ?? 0),
      uniqueLeadsOpened: Number(openedRow?.count ?? 0),
      uniqueLeadsReplied: Number(repliedRow?.count ?? 0),
      failed,
      bounced: Number(bouncedRow?.count ?? 0),
    };
    return { ...counts, ...buildEmailPerformanceRates(counts) };
  }

  /** Buckets FAILED EmailMessage.failureReason into the categories the
   *  dashboard's "Sending Failures" panel shows — anchored to the terminal
   *  EmailEvent{FAILED}'s timestamp, same reasoning as getEmailPerformance's
   *  `failed` count above. */
  async getFailureBreakdown(orgId: string, { from, to }: ResolvedDateRange): Promise<Record<string, number>> {
    const rows = await this.prisma.$queryRaw<{ failureReason: string | null }[]>`
      SELECT m.failure_reason AS "failureReason" FROM email_events e
      JOIN email_messages m ON m.id = e.message_id
      JOIN leads l ON l.id = m.lead_id
      WHERE l.org_id = ${orgId} AND e.event_type = 'FAILED' AND e.occurred_at BETWEEN ${from} AND ${to}
    `;
    const counts: Record<SendFailureCategory, number> = {
      INVALID_EMAIL: 0,
      SUPPRESSED: 0,
      PROVIDER_LIMIT: 0,
      SMTP_PROVIDER_ERROR: 0,
      OTHER: 0,
    };
    for (const row of rows) {
      counts[classifySendFailure(row.failureReason ?? "")]++;
    }
    return Object.fromEntries(
      (Object.keys(counts) as SendFailureCategory[]).map((k) => [SEND_FAILURE_CATEGORY_LABELS[k], counts[k]]),
    );
  }

  /**
   * Daily-bucketed series for the trend chart, one metric at a time (same
   * shape AnalyticsService.getCohortTrends already produces for recharts).
   */
  async getTrends(
    orgId: string,
    { from, to }: ResolvedDateRange,
    metric: "LEADS_UPLOADED" | "EMAILS_SENT" | "EMAILS_OPENED" | "REPLIES" | "FAILURES",
  ): Promise<{ date: string; count: number }[]> {
    const query = {
      LEADS_UPLOADED: Prisma.sql`
        SELECT date_trunc('day', created_at) AS day, COUNT(*) AS count FROM leads
        WHERE org_id = ${orgId} AND uploaded_by_user_id IS NOT NULL AND created_at BETWEEN ${from} AND ${to}
        GROUP BY 1 ORDER BY 1`,
      EMAILS_SENT: Prisma.sql`
        SELECT date_trunc('day', m.sent_at) AS day, COUNT(*) AS count FROM email_messages m
        JOIN leads l ON l.id = m.lead_id
        WHERE l.org_id = ${orgId} AND m.sent_at IS NOT NULL AND m.sent_at BETWEEN ${from} AND ${to}
        GROUP BY 1 ORDER BY 1`,
      EMAILS_OPENED: Prisma.sql`
        SELECT date_trunc('day', m.verified_opened_at) AS day, COUNT(DISTINCT m.lead_id) AS count FROM email_messages m
        JOIN leads l ON l.id = m.lead_id
        WHERE l.org_id = ${orgId} AND m.verified_opened_at IS NOT NULL AND m.verified_opened_at BETWEEN ${from} AND ${to}
        GROUP BY 1 ORDER BY 1`,
      REPLIES: Prisma.sql`
        SELECT date_trunc('day', e.occurred_at) AS day, COUNT(DISTINCT l.id) AS count FROM email_events e
        JOIN email_messages m ON m.id = e.message_id
        JOIN leads l ON l.id = m.lead_id
        WHERE l.org_id = ${orgId} AND e.event_type = 'REPLIED' AND e.occurred_at BETWEEN ${from} AND ${to}
        GROUP BY 1 ORDER BY 1`,
      FAILURES: Prisma.sql`
        SELECT date_trunc('day', e.occurred_at) AS day, COUNT(*) AS count FROM email_events e
        JOIN email_messages m ON m.id = e.message_id
        JOIN leads l ON l.id = m.lead_id
        WHERE l.org_id = ${orgId} AND e.event_type = 'FAILED' AND e.occurred_at BETWEEN ${from} AND ${to}
        GROUP BY 1 ORDER BY 1`,
    }[metric];

    const rows = await this.prisma.$queryRaw<{ day: Date; count: bigint }[]>(query);
    return rows.map((r) => ({ date: r.day.toISOString().slice(0, 10), count: Number(r.count) }));
  }

  /**
   * One row per user who has uploaded at least one lead, ever — not scoped
   * to the range for WHICH USERS appear (a user with zero uploads this
   * week but real history shouldn't vanish from the table), only for their
   * counts. Callers without Role.ADMIN/MANAGER must pass their own userId
   * as `restrictToUserId` — enforced by AnalyticsController, not trusted
   * from a query string here.
   *
   * Every active org member gets a row, not just users who have already
   * uploaded something — filtering to "has uploaded at least one lead ever"
   * meant this table showed literally nobody, for any org, until the very
   * first lead was ever uploaded through the app, which made a genuinely
   * working feature look like it didn't exist at all. A zero row is honest
   * and immediately provable; an empty table is not.
   */
  async getUserBreakdown(orgId: string, range: ResolvedDateRange, restrictToUserId?: string) {
    const uploaders = await this.prisma.user.findMany({
      where: {
        orgId,
        active: true,
        ...(restrictToUserId ? { id: restrictToUserId } : {}),
      },
      select: { id: true, name: true },
    });

    return Promise.all(
      uploaders.map(async (u) => {
        const [{ total: leadsUploaded }, performance] = await Promise.all([
          this.getLeadUploadStats(orgId, range, u.id),
          this.getEmailPerformance(orgId, range, u.id),
        ]);
        return { userId: u.id, userName: u.name, leadsUploaded, ...performance };
      }),
    );
  }
}
