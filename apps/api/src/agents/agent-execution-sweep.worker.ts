import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { AgentExecutionStatus } from "@prisma/client";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";
import { PrismaService } from "../common/prisma/prisma.service";
import { AgentDispatchQueue, AgentDispatchJob } from "../common/queue/agent-dispatch.queue";
import { SequencerService } from "../sequencer/sequencer.service";
import { STALE_RUNNING_MS } from "./agent-execution.service";

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
  }
}
