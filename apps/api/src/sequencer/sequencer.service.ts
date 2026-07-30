import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue, Worker, Job } from "bullmq";
import { ALLOWED_TRANSITIONS, PipelineStage } from "@leadgen/types";
import { PrismaService } from "../common/prisma/prisma.service";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";
import { buildEmail1, buildEmail2 } from "./email-templates";
import { SyncService } from "../sync/sync.service";
import { OrganizationService } from "../organization/organization.service";
import { AgentDispatchQueue } from "../common/queue/agent-dispatch.queue";

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
    private readonly sync: SyncService,
    private readonly organization: OrganizationService,
    private readonly agentDispatch: AgentDispatchQueue,
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
        // dispatchGeminiDraft directly and never reaches here. Without this
        // case, a human advancing straight into this stage — a legal manual
        // transition from WAITING_1_2_DAYS — silently did nothing: the board
        // still showed the "Email agent drafting…" pulsing indicator (it
        // renders off the stage alone, not off real agent activity) while no
        // agent had ever been invoked. This is the fix for that bug.
        return this.dispatchGeminiDraft(leadId);
      default:
        return; // other stages are human- or reply-driven, not sequencer-driven
    }
  }

  /** Stages a lead walks through before it's ready to be contacted — the
   *  segment autoAdvanceToOutreach below auto-chains instead of waiting for
   *  a human to click "advance" at each one. */
  private static readonly PRE_OUTREACH_CHAIN: PipelineStage[] = [
    PipelineStage.NEW_LEAD,
    PipelineStage.VERIFIED,
    PipelineStage.RESEARCH_COMPLETED,
    PipelineStage.UNDER_REVIEW,
  ];

  /**
   * Walks a lead straight through NEW_LEAD -> VERIFIED -> RESEARCH_COMPLETED
   * -> UNDER_REVIEW -> READY_FOR_OUTREACH the moment it's ready, instead of
   * waiting for a human to advance it one stage at a time (Part: autonomous
   * system). A human can still add or edit a review note at any point —
   * that no longer gates outreach from starting, it just stops being
   * required before it can.
   *
   * Stops one stage short of READY_FOR_OUTREACH if the lead's email never
   * verified: auto-discovered leads can't reach this method without a
   * verified email (verification runs before they're ever persisted), but a
   * manually-entered lead can, and auto-sending to an address nothing has
   * confirmed risks the sending domain's reputation on a bounce — the same
   * bar every other lead already had to clear before outreach, just applied
   * here instead of at insert time.
   */
  async autoAdvanceToOutreach(leadId: string): Promise<void> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { verifiedEmail: true },
    });
    if (!lead) return;

    let state = await this.prisma.pipelineState.findUnique({ where: { leadId } });
    while (state && SequencerService.PRE_OUTREACH_CHAIN.includes(state.stage as PipelineStage)) {
      const next = ALLOWED_TRANSITIONS[state.stage as PipelineStage]?.[0];
      if (!next) break;

      if (next === PipelineStage.READY_FOR_OUTREACH && !lead.verifiedEmail) {
        this.logger.log(
          `Lead ${leadId} held at ${state.stage}: email not verified, not auto-advancing to outreach`,
        );
        break;
      }

      state = await this.prisma.pipelineState.update({
        where: { leadId },
        data: { stage: next, previousStage: state.stage, enteredStageAt: new Date() },
      });
      await this.prisma.lead.update({ where: { id: leadId }, data: { lastActivityAt: new Date() } });
      await this.sync.onStageChanged(leadId, next);
      await this.onStageEntered(leadId, next);
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
      await this.dispatchGeminiDraft(leadId);
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

      // LinkedIn task is created in lockstep with Email #1 (Part C7). Copy is
      // drafted automatically too (Part: autonomous system) — the actual
      // send stays a human action (ToS/ban risk), but there's no reason to
      // make someone click a button first just to get a draft ready.
      const existingActivity = await this.prisma.linkedinActivity.findFirst({ where: { leadId } });
      if (!existingActivity) {
        await this.prisma.linkedinActivity.create({ data: { leadId, status: "NOT_STARTED" } });
      }
      if (lead.contactName) {
        await this.agentDispatch.add({ kind: "linkedin_draft", leadId, orgId: lead.orgId });
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

  /**
   * Enqueues the Gemini pitch draft (Part: autonomous system) — used by both
   * the automatic path (onStageEntered, the wait-timer job) and the manual
   * retry (LeadsService.requestPitchDraft). Retries and failure notification
   * are the queue's job now (see AgentDispatchWorker), not this method's —
   * enqueueing itself only fails if Redis itself is unreachable.
   */
  async dispatchGeminiDraft(leadId: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId }, select: { orgId: true } });
    if (!lead) return;
    // Without this, the drafting agent falls back to a hardcoded "our
    // company" identity — the Settings branding fields would silently only
    // affect Email 1/2 and not the Gemini-drafted Email 3.
    const orgContext = await this.organization.getBranding(lead.orgId).then((b) => ({
      name: b.emailOrgName,
      services: "AI automation and lead-generation systems",
      tone_of_voice: "direct, warm, no jargon, no em dashes",
    }));
    await this.agentDispatch.add({ kind: "pitch_draft", leadId, orgId: lead.orgId, orgContext });
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
