import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue, Worker, Job } from "bullmq";
import { PipelineStage } from "@leadgen/types";
import { PrismaService } from "../common/prisma/prisma.service";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";
import { buildEmail1, buildEmail2 } from "./email-templates";
import { SyncService } from "../sync/sync.service";

const WAIT_2_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const WAIT_1_2_DAYS_MS = 36 * 60 * 60 * 1000; // midpoint of the 1-2 day window (Part C6)

/**
 * Owns the stage-driven email cadence (Part C6). Wait timers are BullMQ
 * delayed jobs, not a polling cron, so "wait exactly 2 days" is precise and
 * cancellable the instant a reply arrives (see cancelWaitTimer). The worker
 * that consumes those delayed jobs lives on this same service (not a separate
 * class) so it can drive stage transitions without a circular dependency on
 * LeadsService.
 */
@Injectable()
export class SequencerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SequencerService.name);
  private readonly waitQueue: Queue;
  private readonly emailQueue: Queue;
  private waitWorker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly sync: SyncService,
  ) {
    const connection = getRedisConnection();
    this.waitQueue = new Queue(QUEUE_NAMES.WAIT_TIMERS, { connection });
    this.emailQueue = new Queue(QUEUE_NAMES.EMAIL_SEND, {
      connection,
      // Retry policy per Part E5 — transient failures (e.g. provider 5xx) get
      // exponential backoff; ComplianceGateError is thrown as a non-retryable
      // permanent failure by the worker itself (Part E7).
      defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
    });
  }

  onModuleInit() {
    this.waitWorker = new Worker(
      QUEUE_NAMES.WAIT_TIMERS,
      (job) => this.handleWaitJob(job),
      { connection: getRedisConnection() },
    );
    this.waitWorker.on("failed", (job, err) =>
      this.logger.error(`wait-timer job ${job?.id} failed: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    await this.waitWorker?.close();
  }

  async onStageEntered(leadId: string, stage: PipelineStage): Promise<void> {
    switch (stage) {
      case PipelineStage.READY_FOR_OUTREACH:
        return this.sendEmail1(leadId);
      case PipelineStage.EMAIL_1_SENT:
        return this.scheduleWait(leadId, WAIT_2_DAYS_MS, "send-email-2");
      case PipelineStage.EMAIL_2_SENT:
        return this.scheduleWait(leadId, WAIT_1_2_DAYS_MS, "draft-email-3");
      default:
        return; // other stages are human- or reply-driven, not sequencer-driven
    }
  }

  private async handleWaitJob(job: Job<{ leadId: string; nextAction: string }>) {
    const { leadId, nextAction } = job.data;

    // A reply or manual override may have cancelled this timer already (Part C6);
    // re-check pipeline state before acting instead of trusting the queue alone.
    const state = await this.prisma.pipelineState.findUnique({ where: { leadId } });
    if (!state || state.waitJobId !== job.id) {
      this.logger.log(`Skipping stale wait job for lead ${leadId} (${nextAction})`);
      return;
    }

    if (nextAction === "send-email-2") {
      await this.sendEmail2(leadId);
      await this.prisma.pipelineState.update({
        where: { leadId },
        data: { stage: PipelineStage.EMAIL_2_SENT, enteredStageAt: new Date(), waitJobId: null },
      });
      await this.sync.onStageChanged(leadId, PipelineStage.EMAIL_2_SENT);
      await this.onStageEntered(leadId, PipelineStage.EMAIL_2_SENT);
    } else if (nextAction === "draft-email-3") {
      await this.prisma.pipelineState.update({
        where: { leadId },
        data: { stage: PipelineStage.GEMINI_DRAFTING, enteredStageAt: new Date(), waitJobId: null },
      });
      await this.sync.onStageChanged(leadId, PipelineStage.GEMINI_DRAFTING);
      await this.requestGeminiDraft(leadId);
    }
  }

  private async sendEmail1(leadId: string) {
    const lead = await this.prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    const { subject, bodyHtml } = buildEmail1(lead as any);

    const message = await this.prisma.emailMessage.create({
      data: { leadId, sequenceStep: 1, subject, bodyHtml, generatedBy: "TEMPLATE", status: "QUEUED" },
    });
    await this.emailQueue.add("send", { emailMessageId: message.id });

    // LinkedIn task is created in lockstep with Email #1 (Part C7).
    const existingActivity = await this.prisma.linkedinActivity.findFirst({ where: { leadId } });
    if (!existingActivity) {
      await this.prisma.linkedinActivity.create({ data: { leadId, status: "NOT_STARTED" } });
    }

    // Advance the stage the moment the send is enqueued (same optimistic
    // pattern as Email #2 in handleWaitJob below) so the wait-timer for
    // Email #2 gets scheduled instead of leaving the lead stuck at
    // READY_FOR_OUTREACH forever.
    await this.prisma.pipelineState.update({
      where: { leadId },
      data: { stage: PipelineStage.EMAIL_1_SENT, enteredStageAt: new Date() },
    });
    await this.sync.onStageChanged(leadId, PipelineStage.EMAIL_1_SENT);
    await this.onStageEntered(leadId, PipelineStage.EMAIL_1_SENT);
  }

  private async sendEmail2(leadId: string) {
    const lead = await this.prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    const caseStudy = await this.prisma.caseStudy.findFirst({ where: { orgId: lead.orgId, industry: lead.industry ?? undefined } });
    const { subject, bodyHtml } = buildEmail2(lead as any, caseStudy?.summary);

    const message = await this.prisma.emailMessage.create({
      data: { leadId, sequenceStep: 2, subject, bodyHtml, generatedBy: "TEMPLATE", status: "QUEUED" },
    });
    await this.emailQueue.add("send", { emailMessageId: message.id });
  }

  /** Hands off to the Gemini Personalization Agent (Part D2) via the AI workers service. */
  private async requestGeminiDraft(leadId: string) {
    const aiWorkersUrl = this.config.get<string>("AI_WORKERS_URL", "http://localhost:8000");
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId }, select: { orgId: true } });
    try {
      await fetch(`${aiWorkersUrl}/personalization/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, orgId: lead?.orgId }),
      });
    } catch (err) {
      this.logger.warn(`Failed to request Gemini draft for lead ${leadId}: ${(err as Error).message}`);
      // TODO(Part E7): retry with backoff via a dedicated queue instead of a bare fetch.
    }
  }

  /** Schedules the next automated step after a wait, storing the job id for cancellation. */
  private async scheduleWait(leadId: string, delayMs: number, nextAction: "send-email-2" | "draft-email-3") {
    const job = await this.waitQueue.add(
      nextAction,
      { leadId, nextAction },
      { delay: delayMs, jobId: `wait:${leadId}:${nextAction}:${Date.now()}` },
    );
    await this.prisma.pipelineState.update({
      where: { leadId },
      data: { waitJobId: job.id, nextActionAt: new Date(Date.now() + delayMs) },
    });
  }

  /**
   * Called when a reply is detected or a lead is manually marked Lost/Won
   * (Part C6: "reply detection short-circuits the sequence at every step").
   */
  async cancelWaitTimer(leadId: string) {
    const state = await this.prisma.pipelineState.findUnique({ where: { leadId } });
    if (!state?.waitJobId) return;
    const job = await this.waitQueue.getJob(state.waitJobId);
    if (job && (await job.isDelayed())) {
      await job.remove();
    }
    await this.prisma.pipelineState.update({ where: { leadId }, data: { waitJobId: null } });
  }

  async enqueueApprovedSend(emailMessageId: string) {
    await this.emailQueue.add("send", { emailMessageId });
  }
}
