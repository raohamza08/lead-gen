import { Injectable } from "@nestjs/common";
import { AgentExecutionStatus, PreparationStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { SendingQueueService } from "../sending/sending-queue.service";

/**
 * Which AgentExecution rows must be SUCCEEDED before a step's draft is
 * allowed into the sending queue (Part: Preparation Pipeline / Sending
 * Queue, 2026-09-01). Step 1 also requires the one-time lead-research
 * agents; steps 2-5 only need that step's own draft — enrichment/company
 * research already ran once and is never repeated. linkedin_draft is
 * deliberately excluded: it's a separate human-sent channel, not a gate on
 * email sending.
 */
const PREPARATION_MANIFEST: Record<number, string[]> = {
  1: ["enrich", "company_intelligence", "email_draft"],
  2: ["email_draft"],
  3: ["email_draft"],
  4: ["email_draft"],
  5: ["email_draft"],
};

@Injectable()
export class PreparationPipelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly sendingQueue: SendingQueueService,
  ) {}

  requiredAgentsFor(step: number): string[] {
    return PREPARATION_MANIFEST[step] ?? ["email_draft"];
  }

  /**
   * Recomputes whether `step`'s required agents are all done for this lead
   * and, on COMPLETE, releases that step's already-drafted EmailMessage into
   * the sending queue. Called from every place a required agent's outcome
   * can change (AgentExecutionService.succeed/fail) or the step-1
   * verified-email gate can flip (LeadsService.verifyEmail), plus the two
   * places a QUEUED message is created/approved (LeadsService.receiveEmailDraft/
   * approveEmail) — never from a poll, so preparation status is always
   * driven by a real event. This directly implements requirement #2 (a
   * failed/incomplete agent blocks the sending queue) as a natural
   * consequence of only enqueueing on COMPLETE — nothing else ever calls
   * SendingQueueService.enqueue.
   *
   * `email_draft` is a single per-lead AgentExecution row reused across all
   * 5 steps (AgentExecution's @@unique([leadId, agent])), so a stale
   * SUCCEEDED left over from an earlier step must not count for this one —
   * matched against the row's own `payload.step` before trusting it.
   */
  async evaluate(leadId: string, step: number): Promise<void> {
    const required = this.requiredAgentsFor(step);
    const [lead, executions] = await Promise.all([
      this.prisma.lead.findUnique({ where: { id: leadId }, select: { orgId: true, verifiedEmail: true } }),
      this.prisma.agentExecution.findMany({ where: { leadId, agent: { in: required } } }),
    ]);
    if (!lead) return;

    const byAgent = new Map(executions.map((e) => [e.agent, e]));
    const statusFor = (agent: string): AgentExecutionStatus | undefined => {
      const row = byAgent.get(agent);
      if (!row) return undefined;
      if (agent !== "email_draft") return row.status;
      const payloadStep = (row.payload as Prisma.JsonObject | null)?.step;
      return payloadStep === step ? row.status : undefined;
    };

    const terminalFailure = required.some((agent) => statusFor(agent) === AgentExecutionStatus.FAILED_TERMINAL);
    const allSucceeded =
      (step !== 1 || lead.verifiedEmail) &&
      required.every((agent) => statusFor(agent) === AgentExecutionStatus.SUCCEEDED);

    const status: PreparationStatus = allSucceeded ? "COMPLETE" : terminalFailure ? "FAILED" : "IN_PROGRESS";

    const updated = await this.prisma.pipelineState.updateMany({
      where: { leadId },
      data: {
        preparationStatus: status,
        preparationStep: step,
        preparationCompletedAt: status === "COMPLETE" ? new Date() : null,
      },
    });
    if (updated.count === 0) return;

    this.realtime.emitToOrg(lead.orgId, "preparation.updated", { leadId, step, status });

    if (status !== "COMPLETE") return;

    const message = await this.prisma.emailMessage.findFirst({
      where: { leadId, sequenceStep: step, status: "QUEUED" },
    });
    if (message) {
      await this.sendingQueue.enqueue(lead.orgId, message.id);
    }
  }
}
