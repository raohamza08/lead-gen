import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { CampaignsService } from "../campaigns/campaigns.service";
import {
  AiInsightsSnapshot,
  AnalyticsSummary,
  CohortTrendPoint,
  CohortTrendsReport,
  EmailFunnelReport,
  EmailListItem,
  EmailPerformance,
  EmailStepPerformance,
  FunnelStageCount,
  LinkedinFunnelReport,
  PipelineStage,
  RevenuePipelineReport,
  RevenuePipelineStage,
} from "@leadgen/types";
import { buildPerformance, rate } from "./analytics.math";

/** Stages that mean "a meeting happened or we got further than one". */
const MEETING_OR_BEYOND: PipelineStage[] = [
  PipelineStage.MEETING_BOOKED,
  PipelineStage.PROPOSAL_SENT,
  PipelineStage.WON,
];


/**
 * Backs the Overview dashboard (Part F2). Reads should hit a read replica in
 * production (Part G2) so a dashboard refresh never contends with lead-insert
 * traffic on the primary; this scaffold queries the single configured DB.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignsService,
    private readonly config: ConfigService,
  ) {}

  async getSummary(orgId: string): Promise<AnalyticsSummary> {
    const now = new Date();
    const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - 7);
    const startOfMonth = new Date(now); startOfMonth.setDate(now.getDate() - 30);

    // Every one of these is independent of the others (none reads another's
    // result), so they all belong in one Promise.all. This used to run as a
    // 10-way parallel batch followed by two more FULLY SEQUENTIAL awaits
    // below it — each one paying the database's full round-trip latency
    // again for no reason, on literally the first page a user sees after
    // login. Confirmed live: ~400ms per round trip to this DB region, so
    // that was ~1.2s of pure waiting where ~400ms does the same work.
    const [
      todaysLeads, weeklyLeads, monthlyLeads, verifiedLeads,
      pendingReviews, wonDeals, lostDeals, meetingsBooked, scoreAgg, failedRuns,
      duplicateAgg, tasksWaiting,
    ] = await Promise.all([
      this.prisma.lead.count({ where: { orgId, createdAt: { gte: startOfToday } } }),
      this.prisma.lead.count({ where: { orgId, createdAt: { gte: startOfWeek } } }),
      this.prisma.lead.count({ where: { orgId, createdAt: { gte: startOfMonth } } }),
      this.prisma.lead.count({ where: { orgId, verifiedEmail: true } }),
      this.prisma.pipelineState.count({ where: { stage: PipelineStage.UNDER_REVIEW, lead: { orgId } } }),
      this.prisma.pipelineState.count({ where: { stage: PipelineStage.WON, lead: { orgId } } }),
      this.prisma.pipelineState.count({ where: { stage: PipelineStage.LOST, lead: { orgId } } }),
      this.prisma.pipelineState.count({ where: { stage: PipelineStage.MEETING_BOOKED, lead: { orgId } } }),
      this.prisma.leadScore.aggregate({
        where: { lead: { orgId } },
        _avg: { leadScore: true, aiOpportunityScore: true },
      }),
      // Failed extraction runs in the trailing 24h. Scoped to a window rather
      // than all-time so a fault fixed last week doesn't leave the tile red
      // forever.
      this.prisma.extractionRun.count({
        where: {
          filter: { orgId },
          status: "FAILED",
          startedAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
        },
      }),
      this.prisma.extractionRun.aggregate({
        where: { filter: { orgId } },
        _sum: { leadsFound: true, duplicatesSkipped: true },
      }),
      this.prisma.pipelineState.count({
        where: {
          lead: { orgId },
          stage: {
            in: [
              PipelineStage.WAITING_EMAIL_2,
              PipelineStage.WAITING_EMAIL_3,
              PipelineStage.WAITING_EMAIL_4,
              PipelineStage.WAITING_EMAIL_5,
            ],
          },
        },
      }),
    ]);
    const found = duplicateAgg._sum.leadsFound ?? 0;
    const dup = duplicateAgg._sum.duplicatesSkipped ?? 0;

    return {
      todaysLeads,
      weeklyLeads,
      monthlyLeads,
      verifiedLeads,
      duplicateRate: found > 0 ? Math.round((dup / (found + dup)) * 1000) / 10 : 0,
      avgLeadScore: Math.round(scoreAgg._avg.leadScore ?? 0),
      avgAiOpportunityScore: Math.round(scoreAgg._avg.aiOpportunityScore ?? 0),
      pendingReviews,
      tasksWaiting,
      meetingsBooked,
      wonDeals,
      lostDeals,
      // Extraction-run failures only. Queue dead-letter depth (Part G6) isn't
      // folded in yet, so this undercounts rather than overstating health.
      systemErrors: failedRuns,
    };
  }

  async getFunnel(orgId: string): Promise<FunnelStageCount[]> {
    const stages = Object.values(PipelineStage);
    const counts = await Promise.all(
      stages.map((stage) => this.prisma.pipelineState.count({ where: { stage, lead: { orgId } } })),
    );
    return stages.map((stage, i) => ({ stage, count: counts[i] }));
  }

  /**
   * The email-tracking board (Part F2), overall and sliced by sequence step.
   *
   * Three separate queries rather than one join: message-status counts come off
   * `email_messages`, engagement counts off `email_events`, and outcome counts
   * off `pipeline_states`. Joining all three in one statement would fan the
   * message rows out by their event rows and inflate every status count.
   *
   * Engagement counts are `COUNT(DISTINCT message_id)` — a recipient who opens
   * the same email five times generates five OPENED rows but must count once,
   * or open rate exceeds 100%.
   */
  async getEmailFunnel(orgId: string): Promise<EmailFunnelReport> {
    const [statusRows, eventRows, outcomeRows] = await Promise.all([
      this.prisma.$queryRaw<{ step: number; status: string; count: number }[]>`
        SELECT m.sequence_step AS step, m.status::text AS status, COUNT(*)::int AS count
        FROM email_messages m
        JOIN leads l ON l.id = m.lead_id
        WHERE l.org_id = ${orgId}
        GROUP BY m.sequence_step, m.status
      `,
      this.prisma.$queryRaw<{ step: number; eventType: string; count: number }[]>`
        SELECT m.sequence_step AS step,
               e.event_type::text AS "eventType",
               COUNT(DISTINCT e.message_id)::int AS count
        FROM email_events e
        JOIN email_messages m ON m.id = e.message_id
        JOIN leads l ON l.id = m.lead_id
        WHERE l.org_id = ${orgId}
        GROUP BY m.sequence_step, e.event_type
      `,
      this.prisma.$queryRaw<{ step: number; meetings: number; won: number }[]>`
        SELECT m.sequence_step AS step,
               COUNT(DISTINCT m.lead_id) FILTER (
                 WHERE p.stage::text = ANY(${MEETING_OR_BEYOND as string[]})
               )::int AS meetings,
               COUNT(DISTINCT m.lead_id) FILTER (WHERE p.stage::text = 'WON')::int AS won
        FROM email_messages m
        JOIN leads l ON l.id = m.lead_id
        LEFT JOIN pipeline_states p ON p.lead_id = m.lead_id
        WHERE l.org_id = ${orgId}
        GROUP BY m.sequence_step
      `,
    ]);

    const steps = [
      ...new Set([
        ...statusRows.map((r) => r.step),
        ...eventRows.map((r) => r.step),
        ...outcomeRows.map((r) => r.step),
      ]),
    ].sort((a, b) => a - b);

    const rawByStep = steps.map((step) => {
      const status = (name: string) =>
        statusRows.find((r) => r.step === step && r.status === name)?.count ?? 0;
      const event = (name: string) =>
        eventRows.find((r) => r.step === step && r.eventType === name)?.count ?? 0;
      const outcome = outcomeRows.find((r) => r.step === step);

      return {
        step,
        counts: {
          queued: status("QUEUED"),
          // A message can fail before any event row is written, so FAILED is
          // read from message status as well as the event stream.
          failed: status("FAILED") + event("FAILED"),
          sent: event("SENT"),
          delivered: event("DELIVERED"),
          opened: event("OPENED"),
          clicked: event("CLICKED"),
          replied: event("REPLIED"),
          bounced: event("BOUNCED"),
          spamComplaints: event("SPAM_COMPLAINT"),
          unsubscribed: event("UNSUBSCRIBED"),
          blocked: event("BLOCKED"),
          meetings: outcome?.meetings ?? 0,
          won: outcome?.won ?? 0,
        },
      };
    });

    const bySequenceStep: EmailStepPerformance[] = rawByStep.map(({ step, counts }) => ({
      step,
      ...buildPerformance(counts),
    }));

    // Overall is built from summed *counts*, not from the per-step percentages —
    // averaging rates would weight a step that sent 3 emails the same as one
    // that sent 3,000.
    const overallCounts = rawByStep.reduce(
      (acc, { counts }) => {
        for (const key of Object.keys(acc) as (keyof typeof acc)[]) acc[key] += counts[key];
        return acc;
      },
      {
        queued: 0, failed: 0, sent: 0, delivered: 0, opened: 0, clicked: 0, replied: 0,
        bounced: 0, spamComplaints: 0, unsubscribed: 0, blocked: 0, meetings: 0, won: 0,
      },
    );

    return { overall: buildPerformance(overallCounts), bySequenceStep };
  }

  /**
   * Row-level backing for the Analytics page's Opened/Replied tabs — the
   * email-funnel above only ever returns counts, never which specific
   * messages they're counts of. One row per message that has an event of
   * the requested type, taking the *earliest* occurrence (a message opened
   * five times is one row, not five, and shows when it was first opened).
   */
  async getEmailList(orgId: string, event: "OPENED" | "REPLIED"): Promise<EmailListItem[]> {
    const rows = await this.prisma.$queryRaw<
      {
        id: string; leadId: string; companyName: string; contactName: string | null;
        subject: string; sequenceStep: number; sentAt: Date | null; eventAt: Date;
      }[]
    >`
      SELECT m.id, m.lead_id AS "leadId", l.company_name AS "companyName",
             l.contact_name AS "contactName", m.subject, m.sequence_step AS "sequenceStep",
             m.sent_at AS "sentAt", MIN(e.occurred_at) AS "eventAt"
      FROM email_events e
      JOIN email_messages m ON m.id = e.message_id
      JOIN leads l ON l.id = m.lead_id
      WHERE l.org_id = ${orgId} AND e.event_type = ${event}::"EmailEventType"
      GROUP BY m.id, l.company_name, l.contact_name
      ORDER BY MIN(e.occurred_at) DESC
      LIMIT 200
    `;
    return rows.map((r) => ({
      ...r,
      sentAt: r.sentAt?.toISOString() ?? null,
      eventAt: r.eventAt.toISOString(),
    }));
  }

  /**
   * Real sent-email excerpts for the learning agent's copy-level review
   * (Part: email improvements) — opened-but-never-replied is the group whose
   * subject/opening line is worth questioning (it got attention and then
   * lost it), replied is what's already working and worth reinforcing.
   * Bodies are stripped of markup and truncated: this goes into a prompt,
   * not a mailbox, and a full HTML email is mostly boilerplate/signature.
   */
  private async getEmailSamples(orgId: string) {
    const strip = (html: string) =>
      html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600);

    const [opened, replied] = await Promise.all([
      this.prisma.$queryRaw<{ subject: string; bodyHtml: string; sequenceStep: number }[]>`
        SELECT m.subject, m.body_html AS "bodyHtml", m.sequence_step AS "sequenceStep"
        FROM email_messages m
        JOIN leads l ON l.id = m.lead_id
        WHERE l.org_id = ${orgId}
          AND EXISTS (SELECT 1 FROM email_events e WHERE e.message_id = m.id AND e.event_type = 'OPENED')
          AND NOT EXISTS (SELECT 1 FROM email_events e WHERE e.message_id = m.id AND e.event_type = 'REPLIED')
        ORDER BY m.sent_at DESC
        LIMIT 15
      `,
      this.prisma.$queryRaw<{ subject: string; bodyHtml: string; sequenceStep: number }[]>`
        SELECT m.subject, m.body_html AS "bodyHtml", m.sequence_step AS "sequenceStep"
        FROM email_messages m
        JOIN leads l ON l.id = m.lead_id
        WHERE l.org_id = ${orgId}
          AND EXISTS (SELECT 1 FROM email_events e WHERE e.message_id = m.id AND e.event_type = 'REPLIED')
        ORDER BY m.sent_at DESC
        LIMIT 15
      `,
    ]);

    return {
      openedNoReply: opened.map((m) => ({ ...m, bodyExcerpt: strip(m.bodyHtml), bodyHtml: undefined })),
      replied: replied.map((m) => ({ ...m, bodyExcerpt: strip(m.bodyHtml), bodyHtml: undefined })),
    };
  }

  /**
   * LinkedIn is tracked but never automated (ToS/ban risk) — these numbers come
   * from whatever a human recorded against the lead, so an empty report means
   * "nobody logged anything", not "the integration is broken".
   */
  async getLinkedinFunnel(orgId: string): Promise<LinkedinFunnelReport> {
    // DISTINCT ON keeps only the newest activity row per lead — a lead that
    // progressed CONNECTION_SENT -> ACCEPTED -> REPLIED must count once, at
    // its furthest point, not three times.
    const rows = await this.prisma.$queryRaw<{ status: string; count: number }[]>`
      WITH latest AS (
        SELECT DISTINCT ON (a.lead_id) a.lead_id, a.status
        FROM linkedin_activities a
        JOIN leads l ON l.id = a.lead_id
        WHERE l.org_id = ${orgId}
        ORDER BY a.lead_id, a.updated_at DESC
      )
      SELECT status::text AS status, COUNT(*)::int AS count
      FROM latest
      GROUP BY status
    `;

    const count = (name: string) => rows.find((r) => r.status === name)?.count ?? 0;
    const totalTracked = rows.reduce((sum, r) => sum + r.count, 0);

    // Each status is terminal-so-far, so "reached ACCEPTED" means accepted or
    // anything after it.
    const connectionSent = totalTracked - count("NOT_STARTED");
    const accepted =
      count("ACCEPTED") + count("MESSAGE_SENT") + count("REPLIED") + count("MEETING_SCHEDULED");
    const replied = count("REPLIED") + count("MEETING_SCHEDULED");

    return {
      statusCounts: rows.map((r) => ({ status: r.status, count: r.count })),
      totalTracked,
      acceptanceRate: rate(accepted, connectionSent),
      replyRate: rate(replied, accepted),
      meetingRate: rate(count("MEETING_SCHEDULED"), connectionSent),
    };
  }

  /**
   * Pipeline value by stage. Expected value prefers the human reviewer's number
   * over the AI's — a reviewer who corrects a bad estimate should see the
   * dashboard move.
   */
  async getRevenuePipeline(orgId: string): Promise<RevenuePipelineReport> {
    const rows = await this.prisma.$queryRaw<{ stage: string; count: number; value: number }[]>`
      SELECT p.stage::text AS stage,
             COUNT(*)::int AS count,
             COALESCE(SUM(COALESCE(r.expected_value, s.expected_value, 0)), 0)::float AS value
      FROM pipeline_states p
      JOIN leads l ON l.id = p.lead_id
      LEFT JOIN lead_scores s ON s.lead_id = l.id
      LEFT JOIN review_notes r ON r.lead_id = l.id
      WHERE l.org_id = ${orgId}
      GROUP BY p.stage
    `;

    // Report every stage, including empty ones, in canonical order — a funnel
    // chart with stages missing where the count is zero is misleading.
    const stages: RevenuePipelineStage[] = Object.values(PipelineStage).map((stage) => {
      const row = rows.find((r) => r.stage === stage);
      return { stage, count: row?.count ?? 0, value: Math.round(row?.value ?? 0) };
    });

    const at = (stage: PipelineStage) => stages.find((s) => s.stage === stage)!;
    const won = at(PipelineStage.WON);
    const lost = at(PipelineStage.LOST);
    const openPipelineValue = stages
      .filter((s) => s.stage !== PipelineStage.WON && s.stage !== PipelineStage.LOST)
      .reduce((sum, s) => sum + s.value, 0);

    return {
      stages,
      openPipelineValue,
      wonValue: won.value,
      lostValue: lost.value,
      winRate: rate(won.count, won.count + lost.count),
      avgDealValue: won.count ? Math.round(won.value / won.count) : 0,
    };
  }

  /**
   * Daily trend series over the trailing `days` window. Returns a dense series —
   * days with no activity come back as explicit zeros rather than gaps, so a
   * quiet weekend renders as a dip instead of the line jumping across it.
   */
  async getCohortTrends(orgId: string, days = 30): Promise<CohortTrendsReport> {
    const windowDays = Math.min(Math.max(Math.trunc(days) || 30, 1), 365);
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (windowDays - 1));

    const [leadRows, emailRows, meetingRows] = await Promise.all([
      this.prisma.$queryRaw<
        { date: string; leadsCreated: number; verifiedLeads: number; avgLeadScore: number }[]
      >`
        SELECT to_char(date_trunc('day', l.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS date,
               COUNT(*)::int AS "leadsCreated",
               COUNT(*) FILTER (WHERE l.verified_email)::int AS "verifiedLeads",
               COALESCE(AVG(s.lead_score), 0)::float AS "avgLeadScore"
        FROM leads l
        LEFT JOIN lead_scores s ON s.lead_id = l.id
        WHERE l.org_id = ${orgId} AND l.created_at >= ${since}
        GROUP BY 1
      `,
      this.prisma.$queryRaw<{ date: string; emailsSent: number; replies: number }[]>`
        SELECT to_char(date_trunc('day', e.occurred_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS date,
               COUNT(DISTINCT e.message_id) FILTER (WHERE e.event_type::text = 'SENT')::int AS "emailsSent",
               COUNT(DISTINCT e.message_id) FILTER (WHERE e.event_type::text = 'REPLIED')::int AS replies
        FROM email_events e
        JOIN email_messages m ON m.id = e.message_id
        JOIN leads l ON l.id = m.lead_id
        WHERE l.org_id = ${orgId} AND e.occurred_at >= ${since}
        GROUP BY 1
      `,
      // Current stage only — PipelineState holds one row per lead, so a lead
      // that booked a meeting and then moved to WON no longer counts on its
      // meeting day. An immutable stage-transition log would fix this; noted
      // rather than silently approximated.
      this.prisma.$queryRaw<{ date: string; meetingsBooked: number }[]>`
        SELECT to_char(date_trunc('day', p.entered_stage_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS date,
               COUNT(*)::int AS "meetingsBooked"
        FROM pipeline_states p
        JOIN leads l ON l.id = p.lead_id
        WHERE l.org_id = ${orgId}
          AND p.entered_stage_at >= ${since}
          AND p.stage::text = ANY(${MEETING_OR_BEYOND as string[]})
        GROUP BY 1
      `,
    ]);

    const points: CohortTrendPoint[] = [];
    for (let i = 0; i < windowDays; i += 1) {
      const day = new Date(since);
      day.setUTCDate(since.getUTCDate() + i);
      const date = day.toISOString().slice(0, 10);

      const leads = leadRows.find((r) => r.date === date);
      const emails = emailRows.find((r) => r.date === date);
      const meetings = meetingRows.find((r) => r.date === date);

      points.push({
        date,
        leadsCreated: leads?.leadsCreated ?? 0,
        verifiedLeads: leads?.verifiedLeads ?? 0,
        emailsSent: emails?.emailsSent ?? 0,
        replies: emails?.replies ?? 0,
        meetingsBooked: meetings?.meetingsBooked ?? 0,
        avgLeadScore: Math.round(leads?.avgLeadScore ?? 0),
      });
    }

    return { days: windowDays, points };
  }

  /**
   * Runs the cross-lead `analytics`/`learning` agents on demand. On-demand
   * rather than scheduled: it costs a Claude CLI call, and its output is a
   * recommendation a human reviews, not something that needs to be fresh
   * every minute — matches the "give me the control, don't just spend the
   * quota" pattern already used for enrichment cost elsewhere in this app.
   */
  async getAiInsights(orgId: string): Promise<AiInsightsSnapshot & { notes: string[] }> {
    const [performance, won, lost, emailSamples] = await Promise.all([
      this.campaigns.performance(orgId),
      this.prisma.pipelineState.count({ where: { stage: PipelineStage.WON, lead: { orgId } } }),
      this.prisma.pipelineState.count({ where: { stage: PipelineStage.LOST, lead: { orgId } } }),
      this.getEmailSamples(orgId),
    ]);

    const aiWorkersUrl = this.config.get<string>("AI_WORKERS_URL", "http://localhost:8000");
    let result: { insights?: unknown; recommendations?: unknown; emailImprovements?: unknown; notes?: string[] };
    try {
      const res = await fetch(`${aiWorkersUrl}/optimisation/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, performance, outcomes: { won, lost }, emailSamples }),
      });
      if (!res.ok) throw new Error(`worker responded ${res.status}`);
      result = await res.json();
    } catch (err) {
      throw new ServiceUnavailableException(
        `Could not reach the AI workers for insights: ${(err as Error).message}`,
      );
    }

    // Persisted so the page shows the last real result on load rather than
    // going blank until someone clicks "Run analysis" again — one row per
    // org, each run replacing the last (see AiInsightSnapshot's doc comment).
    const snapshot = await this.prisma.aiInsightSnapshot.upsert({
      where: { orgId },
      create: {
        orgId,
        insights: (result.insights ?? {}) as Prisma.InputJsonValue,
        recommendations: (result.recommendations ?? {}) as Prisma.InputJsonValue,
        emailImprovements: (result.emailImprovements ?? []) as Prisma.InputJsonValue,
      },
      update: {
        generatedAt: new Date(),
        insights: (result.insights ?? {}) as Prisma.InputJsonValue,
        recommendations: (result.recommendations ?? {}) as Prisma.InputJsonValue,
        emailImprovements: (result.emailImprovements ?? []) as Prisma.InputJsonValue,
      },
    });
    // notes are run diagnostics (skip reasons, "requires human approval"),
    // not part of the persisted insight itself — returned alongside the
    // snapshot for the just-ran page, but getLatestAiInsights below (a page
    // reload) won't have them, same as any other ephemeral log line.
    return { ...this.toSnapshotDto(snapshot), notes: result.notes ?? [] };
  }

  /** What the Analytics page loads on mount — the last run's result, or null
   *  if analysis has never been run for this org. Read-only, no CLI cost. */
  async getLatestAiInsights(orgId: string): Promise<AiInsightsSnapshot | null> {
    const snapshot = await this.prisma.aiInsightSnapshot.findUnique({ where: { orgId } });
    return snapshot ? this.toSnapshotDto(snapshot) : null;
  }

  private toSnapshotDto(snapshot: {
    generatedAt: Date; insights: unknown; recommendations: unknown; emailImprovements: unknown;
  }): AiInsightsSnapshot {
    return {
      generatedAt: snapshot.generatedAt.toISOString(),
      insights: snapshot.insights as AiInsightsSnapshot["insights"],
      recommendations: snapshot.recommendations as AiInsightsSnapshot["recommendations"],
      emailImprovements: snapshot.emailImprovements as AiInsightsSnapshot["emailImprovements"],
    };
  }
}
