import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../common/prisma/prisma.service";
import { CampaignsService } from "../campaigns/campaigns.service";
import {
  AnalyticsSummary,
  CohortTrendPoint,
  CohortTrendsReport,
  EmailFunnelReport,
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

    const [
      todaysLeads, weeklyLeads, monthlyLeads, verifiedLeads,
      pendingReviews, wonDeals, lostDeals, meetingsBooked, scoreAgg, failedRuns,
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
    ]);

    const duplicateAgg = await this.prisma.extractionRun.aggregate({
      where: { filter: { orgId } },
      _sum: { leadsFound: true, duplicatesSkipped: true },
    });
    const found = duplicateAgg._sum.leadsFound ?? 0;
    const dup = duplicateAgg._sum.duplicatesSkipped ?? 0;

    const tasksWaiting = await this.prisma.pipelineState.count({
      where: {
        lead: { orgId },
        stage: { in: [PipelineStage.WAITING_2_DAYS, PipelineStage.WAITING_1_2_DAYS] },
      },
    });

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
  async getAiInsights(orgId: string) {
    const [performance, won, lost] = await Promise.all([
      this.campaigns.performance(orgId),
      this.prisma.pipelineState.count({ where: { stage: PipelineStage.WON, lead: { orgId } } }),
      this.prisma.pipelineState.count({ where: { stage: PipelineStage.LOST, lead: { orgId } } }),
    ]);

    const aiWorkersUrl = this.config.get<string>("AI_WORKERS_URL", "http://localhost:8000");
    try {
      const res = await fetch(`${aiWorkersUrl}/optimisation/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, performance, outcomes: { won, lost } }),
      });
      if (!res.ok) throw new Error(`worker responded ${res.status}`);
      return res.json();
    } catch (err) {
      throw new ServiceUnavailableException(
        `Could not reach the AI workers for insights: ${(err as Error).message}`,
      );
    }
  }
}
