import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Prisma, NotificationCategory } from "@prisma/client";
import { PipelineStage } from "@leadgen/types";
import { PrismaService } from "../common/prisma/prisma.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { UserAnalyticsService } from "../analytics/user-analytics.service";
import { CampaignsService } from "../campaigns/campaigns.service";
import { OrganizationService } from "../organization/organization.service";
import { NotificationsService } from "../notifications/notifications.service";

/** Days between automatic cycles — explicit user request: "update the
 *  agents after every 15 days... compare if the stats get improved or get
 *  worse with the last decision." */
const CYCLE_INTERVAL_DAYS = 15;

/** Win rate weighted highest (the actual business outcome), then reply rate,
 *  then open rate (the earliest and weakest signal in the funnel) — the
 *  user explicitly deferred the exact weighting to this judgment call
 *  rather than picking one dimension alone. All three are 0-100 scale
 *  going in, so the result is also 0-100. */
const WEIGHTS = { win: 0.5, reply: 0.35, open: 0.15 };

/** Score deltas smaller than this (percentage points) are noise, not a real
 *  verdict — matters most right after a change, before the sample has had
 *  time to separate signal from week-to-week variance. */
const SCORE_CHANGE_THRESHOLD = 2;

/** Only these confidence levels are ever auto-applied — LOW-confidence
 *  promptUpdates still show up in recommendationsRaw for a human to read,
 *  they're just never written into Settings unattended. */
const AUTO_APPLY_CONFIDENCE = new Set(["MEDIUM", "HIGH"]);

interface PromptUpdate {
  agent: string;
  newPrompt: string;
  rationale?: string;
  confidence?: string;
}

interface AppliedChange {
  agent: string;
  promptBefore: string;
  promptAfter: string;
  rationale: string;
  confidence: string;
}

interface WindowMetrics {
  from: string;
  to: string;
  sent: number;
  openRate: number;
  replyRate: number;
  winRate: number;
  won: number;
  lost: number;
}

/**
 * Automatic agent-prompt tuning loop (Part: Agent Optimization, 2026-09-29,
 * explicit user request): every 15 days, score the org's email performance
 * since the last cycle, judge that score against the PREVIOUS cycle's score
 * (did the last round of changes help?), auto-revert if it got worse, then
 * ask LearningAgent for a fresh round of email-step prompt rewrites and
 * apply the ones it's confident enough about.
 *
 * Deliberately narrow blast radius: the only prompts this can ever touch are
 * email_step_1..5 (see LearningAgent.EMAIL_STEP_NAMES on the AI-workers
 * side) — never lead_discovery/scoring/enrichment, where a bad auto-rewrite
 * would corrupt data quality in a far harder to notice way than a
 * worse-performing email. Every cycle fires a Notification regardless of
 * outcome ("auto-apply and notify", not "auto-apply silently") so a human
 * can catch and revert something that looks wrong before the next cycle's
 * own comparison would.
 */
@Injectable()
export class AgentOptimizationService {
  private readonly logger = new Logger(AgentOptimizationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly userAnalytics: UserAnalyticsService,
    private readonly campaigns: CampaignsService,
    private readonly organization: OrganizationService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  /** One daily tick checking every org's due date, rather than a per-org
   *  dynamic cron registration (NicheFiltersService's pattern) — there's
   *  only ever one fixed interval here, not a per-org-configurable
   *  schedule, so the extra machinery would buy nothing. */
  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async tick() {
    const orgs = await this.prisma.organization.findMany({ select: { id: true } });
    for (const org of orgs) {
      try {
        await this.runCycleIfDue(org.id);
      } catch (err) {
        this.logger.error(`Optimization cycle failed for org ${org.id}: ${(err as Error).message}`);
      }
    }
  }

  async runCycleIfDue(orgId: string) {
    const last = await this.prisma.agentOptimizationCycle.findFirst({ where: { orgId }, orderBy: { runAt: "desc" } });
    if (last) {
      const daysSince = (Date.now() - last.runAt.getTime()) / 86_400_000;
      if (daysSince < CYCLE_INTERVAL_DAYS) {
        return { skipped: true, daysUntilNext: Math.ceil(CYCLE_INTERVAL_DAYS - daysSince) };
      }
    }
    return this.runCycle(orgId, last);
  }

  private async computeWindowMetrics(orgId: string, from: Date, to: Date): Promise<WindowMetrics> {
    const [performance, won, lost] = await Promise.all([
      this.userAnalytics.getEmailPerformance(orgId, { from, to }),
      this.prisma.pipelineState.count({ where: { stage: PipelineStage.WON, lead: { orgId }, enteredStageAt: { gte: from, lte: to } } }),
      this.prisma.pipelineState.count({ where: { stage: PipelineStage.LOST, lead: { orgId }, enteredStageAt: { gte: from, lte: to } } }),
    ]);
    const decided = won + lost;
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      sent: performance.sent,
      openRate: performance.openRate,
      replyRate: performance.replyRate,
      winRate: decided > 0 ? Math.round((won / decided) * 1000) / 10 : 0,
      won,
      lost,
    };
  }

  private score(m: WindowMetrics): number {
    return Math.round((m.winRate * WEIGHTS.win + m.replyRate * WEIGHTS.reply + m.openRate * WEIGHTS.open) * 10) / 10;
  }

  /**
   * Runs one cycle unconditionally (the 15-day gate is runCycleIfDue's job,
   * not this method's) — also the manual "Run now" entry point.
   */
  async runCycle(orgId: string, last?: Awaited<ReturnType<typeof this.prisma.agentOptimizationCycle.findFirst>>) {
    if (last === undefined) {
      last = await this.prisma.agentOptimizationCycle.findFirst({ where: { orgId }, orderBy: { runAt: "desc" } });
    }

    const now = new Date();
    const since = last?.runAt ?? new Date(now.getTime() - CYCLE_INTERVAL_DAYS * 86_400_000);
    const metrics = await this.computeWindowMetrics(orgId, since, now);
    const currentScore = this.score(metrics);

    // Judge the PREVIOUS cycle's changes against this cycle's score — never
    // this cycle's own (not-yet-applied) changes. A cycle with nothing
    // applied last time has nothing to judge; previousScore is still
    // recorded for trend purposes but verdict stays null.
    let verdict: string | null = null;
    if (!last) {
      verdict = "FIRST_RUN";
    } else if (Array.isArray(last.changesApplied) && (last.changesApplied as unknown[]).length > 0 && !last.reverted) {
      const delta = currentScore - last.score;
      if (delta > SCORE_CHANGE_THRESHOLD) verdict = "IMPROVED";
      else if (delta < -SCORE_CHANGE_THRESHOLD) verdict = "WORSENED";
      else verdict = "FLAT";

      if (verdict === "WORSENED") {
        await this.revertChanges(orgId, last.changesApplied as unknown as AppliedChange[]);
        await this.prisma.agentOptimizationCycle.update({ where: { id: last.id }, data: { reverted: true } });
      }
    }

    const [campaignPerformance, emailFunnel] = await Promise.all([
      this.campaigns.performance(orgId).catch(() => []),
      this.analytics.getEmailFunnel(orgId).catch(() => null),
    ]);

    const aiWorkersUrl = this.config.get<string>("AI_WORKERS_URL", "http://localhost:8000");
    let recommendationsRaw: { promptUpdates?: PromptUpdate[]; [key: string]: unknown } = {};
    try {
      const res = await fetch(`${aiWorkersUrl}/optimisation/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          performance: campaignPerformance,
          outcomes: { won: metrics.won, lost: metrics.lost },
          emailStepPerformance: emailFunnel?.bySequenceStep ?? [],
        }),
        signal: AbortSignal.timeout(180_000),
      });
      if (res.ok) recommendationsRaw = await res.json();
      else this.logger.warn(`optimisation/run responded ${res.status} for org ${orgId}`);
    } catch (err) {
      this.logger.warn(`optimisation/run unreachable for org ${orgId}: ${(err as Error).message}`);
    }

    const changesApplied = await this.applyPromptUpdates(orgId, recommendationsRaw.promptUpdates ?? []);

    const cycle = await this.prisma.agentOptimizationCycle.create({
      data: {
        orgId,
        runAt: now,
        metrics: metrics as unknown as Prisma.InputJsonValue,
        score: currentScore,
        previousScore: last?.score ?? null,
        verdict,
        changesApplied: changesApplied as unknown as Prisma.InputJsonValue,
        recommendationsRaw: recommendationsRaw as unknown as Prisma.InputJsonValue,
      },
    });

    await this.notify(orgId, cycle.id, verdict, last?.score ?? null, currentScore, changesApplied);
    return cycle;
  }

  private async applyPromptUpdates(orgId: string, updates: PromptUpdate[]): Promise<AppliedChange[]> {
    const eligible = updates.filter((u) => AUTO_APPLY_CONFIDENCE.has((u.confidence ?? "").toUpperCase()));
    if (eligible.length === 0) return [];

    const currentPrompts = await this.organization.getAgentPrompts(orgId);
    const applied: AppliedChange[] = [];
    for (const update of eligible) {
      const existing = currentPrompts.find((p) => p.name === update.agent);
      if (!existing) continue; // defensive — ai-workers already filters to known email_step_N names
      await this.organization.updateAgentPrompt(orgId, update.agent, update.newPrompt);
      applied.push({
        agent: update.agent,
        promptBefore: existing.currentPrompt,
        promptAfter: update.newPrompt,
        rationale: update.rationale ?? "",
        confidence: (update.confidence ?? "").toUpperCase(),
      });
    }
    return applied;
  }

  private async revertChanges(orgId: string, changes: AppliedChange[]) {
    for (const change of changes) {
      await this.organization.updateAgentPrompt(orgId, change.agent, change.promptBefore);
    }
  }

  private async notify(
    orgId: string,
    cycleId: string,
    verdict: string | null,
    previousScore: number | null,
    currentScore: number,
    changesApplied: AppliedChange[],
  ) {
    const verdictText =
      verdict === "IMPROVED" ? `improved (${previousScore}% → ${currentScore}%) — kept`
      : verdict === "WORSENED" ? `got worse (${previousScore}% → ${currentScore}%) — reverted automatically`
      : verdict === "FLAT" ? `held steady (${previousScore}% → ${currentScore}%)`
      : `first cycle — score is ${currentScore}%`;

    const changesText =
      changesApplied.length === 0
        ? "No prompt changes met the confidence bar this cycle."
        : `Applied ${changesApplied.length} change(s): ${changesApplied.map((c) => c.agent).join(", ")}.`;

    await this.notifications.notify(orgId, {
      category: NotificationCategory.AGENTS,
      type: "AGENT_OPTIMIZATION_CYCLE",
      // No "INFO" severity exists in this system — WARNING is the milder of
      // the two available tiers, used here regardless of verdict so a
      // routine IMPROVED/FLAT cycle doesn't show under the alarming default
      // (ERROR, used elsewhere for things that actually broke).
      severity: "WARNING",
      title: "Agent optimization cycle ran",
      message: `Previous changes ${verdictText}. ${changesText}`,
      actionUrl: "/automation",
      entityType: "agent_optimization_cycle",
      entityId: cycleId,
    });
  }

  async listCycles(orgId: string) {
    return this.prisma.agentOptimizationCycle.findMany({ where: { orgId }, orderBy: { runAt: "desc" }, take: 50 });
  }

  /** Manual revert (Part: "auto-apply + notify with a revert window") — same
   *  logic as the automatic WORSENED-triggered revert above, callable by an
   *  admin who looks at a cycle's changes and disagrees before the next
   *  cycle's own comparison would catch it. */
  async revertCycle(orgId: string, cycleId: string) {
    const cycle = await this.prisma.agentOptimizationCycle.findFirst({ where: { id: cycleId, orgId } });
    if (!cycle) throw new NotFoundException("Optimization cycle not found");
    if (cycle.reverted) return cycle;
    await this.revertChanges(orgId, cycle.changesApplied as unknown as AppliedChange[]);
    return this.prisma.agentOptimizationCycle.update({ where: { id: cycleId }, data: { reverted: true } });
  }
}
