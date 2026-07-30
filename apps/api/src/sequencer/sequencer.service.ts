import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue, Worker, Job } from "bullmq";
import { PipelineStage } from "@leadgen/types";
import { PrismaService } from "../common/prisma/prisma.service";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";
import { buildEmail1, buildEmail2 } from "./email-templates";
import { SyncService } from "../sync/sync.service";
import { OrganizationService } from "../organization/organization.service";

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
    private readonly organization: OrganizationService,
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
        // Entering this stage always ensures Email #2 exists — covers both
        // the normal path (handleWaitJob calls this after sending) and a
        // human dragging straight into "Email 2 Sent" on the board, which
        // otherwise looked like a send with none actually queued. Idempotent
        // via sendEmail2's own existing-message check.
        await this.sendEmail2(leadId);
        return this.scheduleWait(leadId, WAIT_1_2_DAYS_MS, "draft-email-3");
      case PipelineStage.GEMINI_DRAFTING:
        // The automatic path (handleWaitJob's "draft-email-3" branch) calls
        // requestGeminiDraft directly and never reaches here. Without this
        // case, a human advancing straight into this stage — a legal manual
        // transition from WAITING_1_2_DAYS — silently did nothing: the board
        // still showed the "Email agent drafting…" pulsing indicator (it
        // renders off the stage alone, not off real agent activity) while no
        // agent had ever been invoked. This is the fix for that bug.
        return this.requestGeminiDraft(leadId);
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
      await this.prisma.pipelineState.update({
        where: { leadId },
        // previousStage records the immediate predecessor so "back" is
        // accurate regardless of whether the move was human- or
        // automation-driven — see the same note on advanceStage. The actual
        // send happens inside onStageEntered below (sendEmail2), not here.
        data: { stage: PipelineStage.EMAIL_2_SENT, previousStage: state.stage, enteredStageAt: new Date(), waitJobId: null },
      });
      await this.sync.onStageChanged(leadId, PipelineStage.EMAIL_2_SENT);
      await this.onStageEntered(leadId, PipelineStage.EMAIL_2_SENT);
    } else if (nextAction === "draft-email-3") {
      await this.prisma.pipelineState.update({
        where: { leadId },
        data: { stage: PipelineStage.GEMINI_DRAFTING, previousStage: state.stage, enteredStageAt: new Date(), waitJobId: null },
      });
      await this.sync.onStageChanged(leadId, PipelineStage.GEMINI_DRAFTING);
      await this.requestGeminiDraft(leadId);
    }
  }

  /**
   * Enters (or re-enters, on "back" then forward again) READY_FOR_OUTREACH.
   * Idempotent by design: entering this stage a second time must never send a
   * duplicate intro email to the same prospect. If Email #1 already sent or
   * is still queued, this only re-syncs the pipeline stage. If it previously
   * failed (e.g. no mailbox was configured yet), this is exactly how a retry
   * happens — move back to Ready and forward again — so the failed row is
   * replaced with a fresh queued attempt rather than left stuck forever.
   */
  private async sendEmail1(leadId: string) {
    const existing = await this.prisma.emailMessage.findFirst({ where: { leadId, sequenceStep: 1 } });
    if (!existing || existing.status === "FAILED") {
      if (existing) await this.prisma.emailMessage.delete({ where: { id: existing.id } });

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
    }

    // Advance the stage the moment the send is enqueued (same optimistic
    // pattern as Email #2 in handleWaitJob below) so the wait-timer for
    // Email #2 gets scheduled instead of leaving the lead stuck at
    // READY_FOR_OUTREACH forever.
    await this.prisma.pipelineState.update({
      where: { leadId },
      data: { stage: PipelineStage.EMAIL_1_SENT, previousStage: PipelineStage.READY_FOR_OUTREACH, enteredStageAt: new Date() },
    });
    await this.sync.onStageChanged(leadId, PipelineStage.EMAIL_1_SENT);
    await this.onStageEntered(leadId, PipelineStage.EMAIL_1_SENT);
  }

  /** Same idempotency/retry reasoning as sendEmail1 above. */
  private async sendEmail2(leadId: string) {
    const existing = await this.prisma.emailMessage.findFirst({ where: { leadId, sequenceStep: 2 } });
    if (existing && existing.status !== "FAILED") return;
    if (existing) await this.prisma.emailMessage.delete({ where: { id: existing.id } });

    const lead = await this.prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    const caseStudy = await this.prisma.caseStudy.findFirst({ where: { orgId: lead.orgId, industry: lead.industry ?? undefined } });
    const { subject, bodyHtml } = buildEmail2(lead as any, caseStudy?.summary);

    const message = await this.prisma.emailMessage.create({
      data: { leadId, sequenceStep: 2, subject, bodyHtml, generatedBy: "TEMPLATE", status: "QUEUED" },
    });
    await this.emailQueue.add("send", { emailMessageId: message.id });
  }

  /** Automatic call sites (onStageEntered, the wait-timer job): a dispatch
   *  failure here must never block or crash the caller, so it's logged and
   *  swallowed rather than thrown. */
  async requestGeminiDraft(leadId: string) {
    try {
      await this.dispatchGeminiDraft(leadId);
    } catch (err) {
      this.logger.warn(`Failed to request Gemini draft for lead ${leadId}: ${(err as Error).message}`);
      // TODO(Part E7): retry with backoff via a dedicated queue instead of a bare fetch.
    }
  }

  /** Manual retry (LeadsService.requestPitchDraft): unlike the automatic path
   *  above, a failure here must reach the person who clicked the button, so
   *  this throws instead of swallowing. */
  async dispatchGeminiDraft(leadId: string) {
    const aiWorkersUrl = this.config.get<string>("AI_WORKERS_URL", "http://localhost:8000");
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId }, select: { orgId: true } });
    // Without this, the drafting agent falls back to a hardcoded "our
    // company" identity — the Settings branding fields would silently only
    // affect Email 1/2 and not the Gemini-drafted Email 3.
    const orgContext = lead?.orgId
      ? await this.organization.getBranding(lead.orgId).then((b) => ({
          name: b.emailOrgName,
          services: "AI automation and lead-generation systems",
          tone_of_voice: "direct, warm, no jargon, no em dashes",
        }))
      : undefined;
    await fetch(`${aiWorkersUrl}/personalization/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId, orgId: lead?.orgId, orgContext }),
    });
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

  /**
   * Manual retry for a message that failed permanently (ComplianceGateError,
   * e.g. no mailbox was configured or active yet) — those never get retried
   * automatically since a permanent failure is by definition not transient.
   * Only FAILED is eligible: resending an already-SENT message would email
   * the same prospect twice. Caller (LeadsService) verifies the message
   * belongs to the org/lead before calling this.
   */
  async resendFailedMessage(emailMessageId: string) {
    const message = await this.prisma.emailMessage.findUniqueOrThrow({ where: { id: emailMessageId } });
    if (message.status !== "FAILED") {
      throw new BadRequestException(`Only a failed email can be resent (this one is ${message.status})`);
    }
    await this.prisma.emailMessage.update({ where: { id: emailMessageId }, data: { status: "QUEUED" } });
    await this.emailQueue.add("send", { emailMessageId });
  }
}
