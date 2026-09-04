import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { AgentExecutionStatus } from "@prisma/client";
import { PipelineStage } from "@leadgen/types";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";
import { PrismaService } from "../common/prisma/prisma.service";
import { AgentDispatchQueue, AgentDispatchJob } from "../common/queue/agent-dispatch.queue";
import { SequencerService } from "../sequencer/sequencer.service";
import { STALE_RUNNING_MS } from "./agent-execution.service";

/** Mirrors LeadsService's private STEP_FOR_WAITING_STAGE (duplicated rather
 *  than imported to avoid an agents-module -> leads-module dependency for a
 *  5-entry map that changes about as often as the sequence length itself) —
 *  which step a lead waiting at a given stage needs drafted. */
const STEP_FOR_WAITING_STAGE: Partial<Record<PipelineStage, number>> = {
  [PipelineStage.READY_FOR_OUTREACH]: 1,
  [PipelineStage.WAITING_EMAIL_2]: 2,
  [PipelineStage.WAITING_EMAIL_3]: 3,
  [PipelineStage.WAITING_EMAIL_4]: 4,
  [PipelineStage.WAITING_EMAIL_5]: 5,
};

/** Grace window after a redispatch before this row is eligible to be swept
 *  again — long enough for the ai-workers process to receive the dispatch
 *  and call POST /agent-executions/start (seconds, in practice), short
 *  enough that a dispatch that never arrives (ai-workers down) still gets
 *  retried rather than stuck. */
const REDISPATCH_GRACE_MS = 5 * 60 * 1000;

/**
 * Consumes AgentExecutionSweepQueue's repeatable tick (Part: reliability
 * overhaul, 2026-08-31). Two jobs, same pass:
 *
 * 1. Reclaim RUNNING rows a crashed ai-workers process abandoned — a dead
 *    background task never calls /succeed or /fail, so without this a lead
 *    would show "processing" forever instead of eventually retrying.
 * 2. Re-dispatch FAILED_RETRY_SCHEDULED rows whose nextRetryAt has passed,
 *    replaying the exact AgentDispatchQueue job that failed (agent + payload
 *    stored on the row) — this is the automatic-retry loop the spec asks
 *    for; nothing here advances a lead's stage, only AgentDispatchWorker's
 *    normal success path (via the ai-workers callbacks) does that.
 */
@Injectable()
export class AgentExecutionSweepWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentExecutionSweepWorker.name);
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentDispatch: AgentDispatchQueue,
    private readonly sequencer: SequencerService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(QUEUE_NAMES.AGENT_EXECUTION_SWEEP, () => this.tick(), {
      connection: getRedisConnection(),
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`agent-execution sweep tick failed: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async tick() {
    const now = new Date();

    const reclaimed = await this.prisma.agentExecution.updateMany({
      where: { status: AgentExecutionStatus.RUNNING, lastAttemptAt: { lt: new Date(now.getTime() - STALE_RUNNING_MS) } },
      data: { status: AgentExecutionStatus.FAILED_RETRY_SCHEDULED, nextRetryAt: now, errorSummary: "Agent execution failed" },
    });
    if (reclaimed.count > 0) {
      this.logger.warn(`Reclaimed ${reclaimed.count} abandoned RUNNING execution(s)`);
    }

    const due = await this.prisma.agentExecution.findMany({
      where: { status: AgentExecutionStatus.FAILED_RETRY_SCHEDULED, nextRetryAt: { lte: now } },
      include: { lead: { select: { orgId: true } } },
      take: 100,
    });

    for (const row of due) {
      try {
        const payload = (row.payload as Record<string, unknown> | null) ?? {};
        if (row.agent === "email_draft") {
          // dispatchEmailDraft's own idempotency check (delete-and-redraft a
          // FAILED sequenceStep row) must run before redispatching, or a
          // direct agentDispatch.add() here would let receiveEmailDraft
          // create a second EmailMessage row for the same step alongside
          // the FAILED one already there.
          await this.sequencer.dispatchEmailDraft(row.leadId, payload.step as number);
        } else {
          const job = {
            kind: row.agent as AgentDispatchJob["kind"],
            leadId: row.leadId,
            orgId: row.lead.orgId,
            ...payload,
          } as AgentDispatchJob;
          await this.agentDispatch.add(job);
        }
        await this.prisma.agentExecution.update({
          where: { id: row.id },
          data: { nextRetryAt: new Date(Date.now() + REDISPATCH_GRACE_MS) },
        });
      } catch (err) {
        this.logger.error(`could not redispatch ${row.agent} for lead ${row.leadId}: ${(err as Error).message}`);
      }
    }

    await this.recoverOrphanedDrafts();
  }

  /**
   * Catches leads stuck at a waiting stage with a FAILED, contentless
   * step draft that has NO AgentExecution row at all (Part: lead retry
   * automation, 2026-09-04) — the loop above only ever finds rows already
   * *inside* the tracked FAILED_RETRY_SCHEDULED system, so a lead whose
   * draft attempt never registered one in the first place (confirmed live:
   * pre-dating this tracking existing at all, or a dispatch where
   * ai-workers' own start_execution call never landed) was invisible to it
   * forever — no button existed either, so these leads had no path back to
   * automation short of a human manually re-triggering them one at a time.
   *
   * Only fires once per orphaned lead: redispatching goes through the same
   * sequencer.dispatchEmailDraft path requestEmailDraft uses, which this
   * time DOES get picked up by ai-workers' normal start_execution call, so
   * a further failure lands a real AgentExecution row and from then on is
   * handled by the loop above (including NOTIFY_AFTER_ATTEMPTS) like any
   * other agent — this is a one-time "adopt into tracking," not a parallel
   * retry system.
   */
  private async recoverOrphanedDrafts() {
    const waitingStages = Object.keys(STEP_FOR_WAITING_STAGE) as PipelineStage[];
    const states = await this.prisma.pipelineState.findMany({
      where: { stage: { in: waitingStages }, preparationStatus: { in: ["NOT_STARTED", "FAILED"] } },
      select: { leadId: true, stage: true },
      take: 200,
    });

    for (const state of states) {
      const step = STEP_FOR_WAITING_STAGE[state.stage];
      if (!step) continue;

      const [message, execution] = await Promise.all([
        this.prisma.emailMessage.findFirst({
          where: { leadId: state.leadId, sequenceStep: step },
          select: { status: true, subject: true, bodyHtml: true },
        }),
        this.prisma.agentExecution.findUnique({ where: { leadId_agent: { leadId: state.leadId, agent: "email_draft" } } }),
      ]);
      const isOrphanedFailure = message?.status === "FAILED" && !message.subject && !message.bodyHtml && !execution;
      if (!isOrphanedFailure) continue;

      try {
        await this.sequencer.dispatchEmailDraft(state.leadId, step);
        this.logger.warn(`Recovered orphaned failed draft for lead ${state.leadId} (step ${step}, no prior AgentExecution tracking)`);
      } catch (err) {
        this.logger.error(`could not recover orphaned draft for lead ${state.leadId}: ${(err as Error).message}`);
      }
    }
  }
}
