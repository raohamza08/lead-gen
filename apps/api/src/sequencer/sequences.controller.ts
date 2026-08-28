import { Controller, Get, Post, UseGuards } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { ModuleAccessGuard } from "../common/guards/module-access.guard";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims, PipelineStage } from "@leadgen/types";
import { EmailAccountsService } from "../email/email-accounts.service";

/** Which step a lead waiting between sequence emails is waiting *for* — the
 *  controller-side twin of SequencerService's private NEXT_EMAIL_STEP map,
 *  needed here only to label a send-queue row, not to drive any transition. */
const NEXT_STEP_FOR_WAITING_STAGE: Partial<Record<PipelineStage, number>> = {
  [PipelineStage.WAITING_EMAIL_2]: 2,
  [PipelineStage.WAITING_EMAIL_3]: 3,
  [PipelineStage.WAITING_EMAIL_4]: 4,
  [PipelineStage.WAITING_EMAIL_5]: 5,
};
const WAITING_STAGES = Object.keys(NEXT_STEP_FOR_WAITING_STAGE) as PipelineStage[];

/**
 * Read endpoints backing the Sequences dashboard tab (Part F1): the
 * Approvals & Failed Sends queue and the upcoming-send calendar. Mutations
 * (approve/edit/reject/resend one) already exist on `POST /leads/:id/
 * approve-email` and `POST /leads/:id/resend-email` — kept there since they
 * operate on a specific lead, not the sequence-wide view. The bulk resend
 * below is the one queue-wide mutation, so it lives here instead.
 */
@Controller("sequences")
@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule("LEAD_GENERATION")
export class SequencesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailAccounts: EmailAccountsService,
  ) {}

  /**
   * Everything a human needs to act on: drafts genuinely awaiting approval
   * (PENDING_APPROVAL) alongside emails that failed to send (FAILED) — one
   * queue, since both are "something needs to happen before this reaches the
   * prospect." Distinguished by `status` in the response; the frontend
   * renders Approve/Reject for one and Resend for the other.
   */
  @Get("pending-approvals")
  pendingApprovals(@CurrentUser() user: JwtClaims) {
    return this.prisma.emailMessage.findMany({
      where: { status: { in: ["PENDING_APPROVAL", "FAILED"] }, lead: { orgId: user.orgId } },
      include: { lead: { select: { id: true, companyName: true, contactName: true, email: true } } },
      orderBy: { id: "desc" },
    });
  }

  /** One click to retry every FAILED email in the queue above — see
   *  EmailAccountsService.resendAllFailed for the send behavior. */
  @Post("resend-all-failed")
  resendAllFailed(@CurrentUser() user: JwtClaims) {
    return this.emailAccounts.resendAllFailed(user.orgId);
  }

  /**
   * Leads counting down the real wait timer before their next sequence
   * step's draft is triggered (`PipelineState.nextActionAt`, set precisely
   * in SequencerService.scheduleWait) — for the Automation page's "when
   * does this go out" question. Emails no longer sit in a queue between
   * drafted and sent (Part E5, revised — sends happen synchronously), so
   * this is the only row type with a genuine future clock time left to show.
   */
  @Get("send-queue")
  async sendQueue(@CurrentUser() user: JwtClaims) {
    const waitingStates = await this.prisma.pipelineState.findMany({
      where: {
        stage: { in: WAITING_STAGES },
        lead: { orgId: user.orgId },
      },
      include: { lead: { select: { id: true, companyName: true } } },
      orderBy: { nextActionAt: "asc" },
      take: 100,
    });

    return {
      waiting: waitingStates.map((s) => ({
        leadId: s.leadId,
        lead: s.lead,
        nextStep: NEXT_STEP_FOR_WAITING_STAGE[s.stage],
        nextActionAt: s.nextActionAt,
      })),
    };
  }
}
