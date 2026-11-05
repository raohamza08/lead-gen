import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { PipelineStage } from "@leadgen/types";
import { PrismaService } from "../common/prisma/prisma.service";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";
import { OrganizationService } from "../organization/organization.service";
import { ClaudeRateLimitService } from "../agents/claude-rate-limit.service";
import { SequencerService } from "./sequencer.service";

/** Mirrors LeadsService's private STEP_FOR_WAITING_STAGE / SequencerService's
 *  former NEXT_EMAIL_STEP (duplicated rather than imported — same reasoning
 *  AgentExecutionSweepWorker's own copy of this exact map gives: a 4-entry
 *  map that changes about as often as the sequence length itself isn't
 *  worth a cross-module dependency for). */
const STEP_FOR_WAITING_STAGE: Partial<Record<PipelineStage, number>> = {
  [PipelineStage.WAITING_EMAIL_2]: 2,
  [PipelineStage.WAITING_EMAIL_3]: 3,
  [PipelineStage.WAITING_EMAIL_4]: 4,
  [PipelineStage.WAITING_EMAIL_5]: 5,
};
const WAITING_STAGES = Object.keys(STEP_FOR_WAITING_STAGE) as PipelineStage[];

/** Hard safety cap per tick, same shape as every other sweep's `take` in
 *  this codebase (AgentExecutionSweepWorker, SequencerService's own
 *  recoverStuckWaits) — no realistic org should ever have more due at once,
 *  and if one somehow does, the next tick 90s later picks up the rest. */
const MAX_DUE_PER_TICK = 500;

/** Redis key for how many agent calls this org's drip scheduler has
 *  dispatched in the current wall-clock hour — INCRs with a 2h TTL so a
 *  bucket from an hour that's over cleans itself up without a separate job. */
function hourBucketKey(orgId: string): string {
  const hour = new Date().toISOString().slice(0, 13); // "2026-11-05T16"
  return `claude-calls:${orgId}:${hour}`;
}

/**
 * Consumes DraftSchedulerQueue's repeatable tick (Part: Claude-budget-aware
 * drip scheduler, 2026-11-05). Finds every lead sitting at a WAITING_EMAIL_N
 * stage (SequencerService.onStageEntered marks this as "due" and stops —
 * see its own docblock for why actual dispatch moved here) and dispatches
 * each one's draft via the existing SequencerService.dispatchEmailDraft,
 * but only up to however much of the org's claudeAgentCallsPerHour budget
 * is left this hour, and never while that org's circuit breaker
 * (ClaudeRateLimitService) is tripped.
 *
 * This spreads follow-up drafting across the whole day leading into the
 * org's fixed daily send time (SendingSchedule) instead of letting however
 * many leads' 3-business-day waits happen to land at the same moment fire
 * all at once — the actual problem this exists to solve. Sending itself is
 * untouched: once a draft succeeds, the existing
 * PreparationPipelineService -> SendingQueueService -> SendingSchedule path
 * (already fixed-time, already paced across mailboxes) is unchanged.
 */
@Injectable()
export class DraftSchedulerWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DraftSchedulerWorker.name);
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly organization: OrganizationService,
    private readonly claudeRateLimit: ClaudeRateLimitService,
    private readonly sequencer: SequencerService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(QUEUE_NAMES.DRAFT_SCHEDULER, () => this.tick(), {
      connection: getRedisConnection(),
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`draft-scheduler tick failed: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async tick() {
    const due = await this.prisma.pipelineState.findMany({
      where: { stage: { in: WAITING_STAGES } },
      include: { lead: { select: { orgId: true } } },
      take: MAX_DUE_PER_TICK,
    });
    if (due.length === 0) return;

    // One budget check per org per tick, not per lead — groups the flat
    // query above (same "query directly, not a per-org loop" shape
    // AgentExecutionSweepWorker already uses) by orgId.
    const byOrg = new Map<string, typeof due>();
    for (const row of due) {
      const bucket = byOrg.get(row.lead.orgId) ?? [];
      bucket.push(row);
      byOrg.set(row.lead.orgId, bucket);
    }

    for (const [orgId, rows] of byOrg) {
      if (await this.claudeRateLimit.isRateLimited(orgId)) {
        this.logger.warn(`Skipping ${rows.length} due draft(s) for org ${orgId} — Claude rate-limit cooldown active`);
        continue;
      }

      const { claudeAgentCallsPerHour } = await this.organization.getAutomationSettings(orgId);
      const connection = getRedisConnection();
      const key = hourBucketKey(orgId);
      const consumedSoFar = Number((await connection.get(key)) ?? 0);
      let remaining = claudeAgentCallsPerHour - consumedSoFar;
      if (remaining <= 0) continue;

      for (const row of rows) {
        if (remaining <= 0) break;

        // Re-validate immediately before dispatching (Part: Claude-budget-
        // aware drip scheduler, 2026-11-05, explicit user request — don't
        // waste a Claude call on a lead that already left the funnel
        // between being marked due and this tick actually getting to it).
        const fresh = await this.prisma.pipelineState.findUnique({ where: { leadId: row.leadId } });
        const step = fresh ? STEP_FOR_WAITING_STAGE[fresh.stage] : undefined;
        if (!fresh || !step) continue; // replied/unsubscribed/moved on since being queried — correctly skipped, not a bug

        try {
          await this.sequencer.dispatchEmailDraft(row.leadId, step);
          const afterIncr = await connection.incr(key);
          if (afterIncr === 1) await connection.expire(key, 2 * 60 * 60);
          remaining--;
        } catch (err) {
          this.logger.error(`could not dispatch draft for lead ${row.leadId} (step ${step}): ${(err as Error).message}`);
        }
      }
    }
  }
}
