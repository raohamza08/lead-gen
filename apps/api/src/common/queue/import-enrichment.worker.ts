import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Job, Worker } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "./redis-connection";
import { PrismaService } from "../prisma/prisma.service";
import { AgentDispatchQueue } from "./agent-dispatch.queue";
import type { ImportEnrichmentJob } from "./import-enrichment.queue";

const POLL_INTERVAL_MS = 5000;
// A full manual-lead enrichment run (6 sequential Claude CLI calls) normally
// finishes in 1-3 minutes. 10 minutes is a generous ceiling for a slow one —
// past it, this gives up waiting on that lead specifically and moves on to
// the next queued one, so one stuck lead can't stall an entire import.
const MAX_WAIT_MS = 10 * 60 * 1000;

/**
 * Processes one imported lead's enrichment at a time (Part: lead import).
 * Concurrency 1 on this queue is what makes "one at a time" literal, not
 * just an approximation via a delay between dispatches. Dispatches through
 * the normal AgentDispatchQueue (so the existing retry/failure-notification
 * behavior still applies), then waits for that lead to actually finish —
 * signalled by an AgentRun row for "lead_scoring" (Part: pipeline
 * simplification, 2026-08-29 — this used to watch the pipeline stage move
 * off NEW_LEAD, but a freshly-imported lead has no PipelineState at all
 * until explicitly promoted, so that check never actually fired; scoring is
 * the terminal agent in every enrichment run — see agent-architecture notes
 * — so its AgentRun landing is the real completion signal) — before letting
 * the next queued lead start.
 */
@Injectable()
export class ImportEnrichmentWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImportEnrichmentWorker.name);
  private worker?: Worker<ImportEnrichmentJob>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentDispatch: AgentDispatchQueue,
  ) {}

  onModuleInit() {
    this.worker = new Worker<ImportEnrichmentJob>(
      QUEUE_NAMES.IMPORT_ENRICHMENT,
      (job) => this.handle(job),
      { connection: getRedisConnection(), concurrency: 1 },
    );
    this.worker.on("failed", (job, err) =>
      this.logger.error(`import-enrichment job ${job?.id} failed: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async handle(job: Job<ImportEnrichmentJob>): Promise<void> {
    const { leadId, orgId } = job.data;
    const dispatchedAt = new Date();
    await this.agentDispatch.add({ kind: "enrich", leadId, orgId });

    const startedAt = Date.now();
    while (Date.now() - startedAt < MAX_WAIT_MS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const lead = await this.prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
      if (!lead) return; // deleted mid-import — nothing left to wait for

      const scored = await this.prisma.agentRun.findFirst({
        where: { leadId, agent: "lead_scoring", startedAt: { gte: dispatchedAt } },
        select: { id: true },
      });
      if (scored) return;
    }
    this.logger.warn(
      `Lead ${leadId} still not scored after ${MAX_WAIT_MS}ms — moving on to the next imported lead anyway`,
    );
  }
}
