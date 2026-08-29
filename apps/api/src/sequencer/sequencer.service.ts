import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue, Worker, Job } from "bullmq";
import { PipelineStage } from "@leadgen/types";
import { PrismaService } from "../common/prisma/prisma.service";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";
import { SyncService } from "../sync/sync.service";
import { OrganizationService } from "../organization/organization.service";
import { AgentDispatchQueue } from "../common/queue/agent-dispatch.queue";
import { EmailProviderService } from "../email/email-provider.service";

//: 3 business days between every step of the 5-email sequence (Part: 5-email
//: sequence, 2026-08-12). Weekends are skipped in the COUNT itself, not just
//: pushed off if the final day happens to land on one — see
//: businessDaysDelayMs — so "3 business days" means what it says regardless
//: of which day of the week a step lands on.
const SEQUENCE_WAIT_BUSINESS_DAYS = 3;

//: Which stage a wait started in this stage should land in next, and which
//: email step that stage exists to draft — the single source of truth
//: onStageEntered reads, instead of a growing if/else chain per stage.
const WAIT_AFTER: Partial<Record<PipelineStage, PipelineStage>> = {
  [PipelineStage.EMAIL_1_SENT]: PipelineStage.WAITING_EMAIL_2,
  [PipelineStage.EMAIL_2_SENT]: PipelineStage.WAITING_EMAIL_3,
  [PipelineStage.EMAIL_3_SENT]: PipelineStage.WAITING_EMAIL_4,
  [PipelineStage.EMAIL_4_SENT]: PipelineStage.WAITING_EMAIL_5,
};

const NEXT_EMAIL_STEP: Partial<Record<PipelineStage, number>> = {
  [PipelineStage.WAITING_EMAIL_2]: 2,
  [PipelineStage.WAITING_EMAIL_3]: 3,
  [PipelineStage.WAITING_EMAIL_4]: 4,
  [PipelineStage.WAITING_EMAIL_5]: 5,
};

/** How many business days from now, skipping Saturdays/Sundays in the count
 *  itself (not just the landing day) — 3 business days starting Thursday
 *  lands the following Tuesday, not Sunday pushed to Monday. */
function businessDaysDelayMs(days: number): number {
  const now = Date.now();
  const d = new Date(now);
  let count = 0;
  while (count < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return d.getTime() - now;
}

/**
 * Owns the stage-driven email cadence for the 5-email sequence (Part:
 * 5-email sequence, 2026-08-12): Problem Trigger -> Industry Insight -> Proof
 * -> Soft Offer -> Breakup, each AI-drafted, 3 business days apart. Wait
 * timers are BullMQ delayed jobs, not a polling cron, so a wait is precise
 * and cancellable the instant a reply arrives (see cancelWaitTimer). The
 * worker that consumes those delayed jobs lives on this same service (not a
 * separate class) so it can drive stage transitions without a circular
 * dependency on LeadsService.
 */
@Injectable()
export class SequencerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SequencerService.name);
  private readonly waitQueue: Queue;
  private waitWorker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
    private readonly organization: OrganizationService,
    private readonly agentDispatch: AgentDispatchQueue,
    private readonly emailProvider: EmailProviderService,
  ) {
    const connection = getRedisConnection();
    this.waitQueue = new Queue(QUEUE_NAMES.WAIT_TIMERS, { connection });
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

  /**
   * Single dispatch point for every stage the sequence drives. Handles both
   * the automatic path (handleWaitJob transitions into a stage, then calls
   * this) and a human manually dragging a card straight into one of these
   * stages — both go through the exact same code here, so neither path can
   * silently do nothing the way the old GEMINI_DRAFTING-only special case
   * used to require a comment to explain.
   */
  async onStageEntered(leadId: string, stage: PipelineStage): Promise<void> {
    if (stage === PipelineStage.READY_FOR_OUTREACH) {
      await this.setUpLinkedin(leadId);
      return this.dispatchEmailDraft(leadId, 1);
    }

    const waitInto = WAIT_AFTER[stage];
    if (waitInto) {
      return this.scheduleWait(leadId, waitInto);
    }

    const step = NEXT_EMAIL_STEP[stage];
    if (step) {
      return this.dispatchEmailDraft(leadId, step);
    }
    // other stages are human- or reply-driven, not sequencer-driven
  }

  /**
   * Kicks off outreach for a lead already sitting at READY_FOR_OUTREACH —
   * setting up LinkedIn and dispatching Email 1 — the moment its email is
   * verified (Part: autonomous system). Every lead now lands at
   * READY_FOR_OUTREACH on creation/promotion (there's no earlier stage to
   * walk through any more), so this is just the verified-email gate that
   * used to sit ahead of it, called from wherever verifiedEmail can flip to
   * true: lead creation, CSV-promotion, enrichment landing verifiedEmail,
   * or the "Verify emails" bulk action.
   *
   * Both onStageEntered side effects (setUpLinkedin, dispatchEmailDraft) are
   * idempotent — a lead already past READY_FOR_OUTREACH, or already
   * outreach-dispatched, is a safe no-op to call this against again.
   */
  async maybeEnterOutreach(leadId: string): Promise<void> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { verifiedEmail: true },
    });
    if (!lead?.verifiedEmail) return;

    const state = await this.prisma.pipelineState.findUnique({ where: { leadId } });
    if (!state || state.stage !== PipelineStage.READY_FOR_OUTREACH) return;

    await this.onStageEntered(leadId, PipelineStage.READY_FOR_OUTREACH);
  }

  private async handleWaitJob(job: Job<{ leadId: string; nextStage: PipelineStage }>) {
    const { leadId, nextStage } = job.data;

    // A reply or manual override may have cancelled this timer already (Part C6);
    // re-check pipeline state before acting instead of trusting the queue alone.
    const state = await this.prisma.pipelineState.findUnique({ where: { leadId } });
    if (!state || state.waitJobId !== job.id) {
      this.logger.log(`Skipping stale wait job for lead ${leadId} (-> ${nextStage})`);
      return;
    }

    await this.prisma.pipelineState.update({
      where: { leadId },
      data: { stage: nextStage, previousStage: state.stage, enteredStageAt: new Date(), waitJobId: null },
    });
    await this.sync.onStageChanged(leadId, nextStage);
    await this.onStageEntered(leadId, nextStage);
  }

  /** LinkedIn task + copy draft, created in lockstep with Email #1 (Part C7).
   *  The actual send stays a human action (ToS/ban risk) — this only removes
   *  the blank-page problem for the person sending it. */
  private async setUpLinkedin(leadId: string) {
    const lead = await this.prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    const existingActivity = await this.prisma.linkedinActivity.findFirst({ where: { leadId } });
    if (!existingActivity) {
      await this.prisma.linkedinActivity.create({ data: { leadId, status: "NOT_STARTED" } });
    }
    if (lead.contactName) {
      await this.agentDispatch.add({ kind: "linkedin_draft", leadId, orgId: lead.orgId });
    }
  }

  /**
   * Dispatches an AI draft for one step of the 5-email sequence (Part:
   * 5-email sequence, 2026-08-12) — used by both the automatic path
   * (onStageEntered) and the manual retry (LeadsService.requestEmailDraft).
   * Retries and failure notification are the queue's job now (see
   * AgentDispatchWorker), not this method's — enqueueing itself only fails
   * if Redis itself is unreachable.
   *
   * Idempotent: a non-failed message already existing for this step means
   * skip — this is what makes moving a lead back a stage and forward again
   * a safe retry rather than a duplicate draft landing in the send queue
   * twice.
   */
  async dispatchEmailDraft(leadId: string, step: number): Promise<void> {
    const existing = await this.prisma.emailMessage.findFirst({ where: { leadId, sequenceStep: step } });
    if (existing) {
      if (existing.status !== "FAILED") return;
      await this.prisma.emailMessage.delete({ where: { id: existing.id } });
    }

    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { orgId: true, industry: true },
    });
    if (!lead) return;

    // Without this, the drafting agent falls back to a hardcoded "our
    // company" identity — the Settings branding fields would silently only
    // affect nothing rather than every AI-drafted email.
    const branding = await this.organization.getBranding(lead.orgId);
    const orgContext = {
      name: branding.emailOrgName,
      services: "AI automation and lead-generation systems",
      tone_of_voice: "direct, warm, no jargon, no em dashes",
    };

    // Only Email 3 ("Proof") is allowed to reference a case study — see the
    // 5-email sequence spec. Fetched here rather than in the worker because
    // the worker never talks to the DB directly (Part B1).
    let caseStudy: { title: string; summary: string; metrics: unknown } | null = null;
    if (step === 3) {
      const cs = await this.prisma.caseStudy.findFirst({
        where: { orgId: lead.orgId, industry: lead.industry ?? undefined, status: "READY" },
      });
      if (cs) caseStudy = { title: cs.title, summary: cs.summary, metrics: cs.metrics };
    }

    await this.agentDispatch.add({
      kind: "email_draft",
      leadId,
      orgId: lead.orgId,
      step,
      orgContext,
      caseStudy,
    });
  }

  /** Schedules the next automated step after a wait, storing the job id for cancellation. */
  private async scheduleWait(leadId: string, nextStage: PipelineStage): Promise<void> {
    const delayMs = businessDaysDelayMs(SEQUENCE_WAIT_BUSINESS_DAYS);
    const job = await this.waitQueue.add(
      "advance",
      { leadId, nextStage },
      { delay: delayMs, jobId: `wait:${leadId}:${nextStage}:${Date.now()}` },
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

  /** Sends an approved draft immediately (Part E5, revised) — no queue: the
   *  caller gets the real outcome (SENT or FAILED, with reason) in this same
   *  call, not "queued" with the actual result arriving later somewhere else. */
  async enqueueApprovedSend(emailMessageId: string) {
    return this.emailProvider.sendMessageNow(emailMessageId);
  }

  /**
   * Manual retry for a message that failed to send. Only FAILED is eligible:
   * resending an already-SENT message would email the same prospect twice.
   * Caller (LeadsService) verifies the message belongs to the org/lead before
   * calling this. One direct attempt, same as enqueueApprovedSend — no queue,
   * no automatic re-retry; if it fails again the row shows FAILED with the
   * new reason immediately, and the operator decides whether to try again.
   */
  async resendFailedMessage(emailMessageId: string) {
    const message = await this.prisma.emailMessage.findUniqueOrThrow({ where: { id: emailMessageId } });
    if (message.status !== "FAILED") {
      throw new BadRequestException(`Only a failed email can be resent (this one is ${message.status})`);
    }
    return this.emailProvider.sendMessageNow(emailMessageId);
  }
}
