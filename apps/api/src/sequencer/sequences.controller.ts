import { Controller, Get, UseGuards } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { ModuleAccessGuard } from "../common/guards/module-access.guard";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims, PipelineStage } from "@leadgen/types";

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
 * Read endpoints backing the Sequences dashboard tab (Part F1): the Email #3
 * approval queue and the upcoming-send calendar. Mutations (approve/edit/
 * reject) already exist on `POST /leads/:id/approve-email` — kept there since
 * they operate on a specific lead, not the sequence-wide view.
 */
@Controller("sequences")
@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule("LEAD_GENERATION")
export class SequencesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("pending-approvals")
  pendingApprovals(@CurrentUser() user: JwtClaims) {
    return this.prisma.emailMessage.findMany({
      where: { status: "PENDING_APPROVAL", lead: { orgId: user.orgId } },
      include: { lead: { select: { id: true, companyName: true, contactName: true, email: true } } },
      orderBy: { id: "desc" },
    });
  }

  @Get("upcoming")
  upcoming(@CurrentUser() user: JwtClaims) {
    return this.prisma.emailMessage.findMany({
      where: { status: "QUEUED", lead: { orgId: user.orgId } },
      include: { lead: { select: { id: true, companyName: true } }, account: { select: { address: true } } },
      // `scheduledAt` is never written anywhere in this codebase (the send
      // queue has no delay — a QUEUED email is picked up within moments), so
      // ordering by it sorted nothing. `createdAt` is the field that actually
      // reflects queue order (BullMQ processes "email-send" FIFO).
      orderBy: { createdAt: "asc" },
      take: 100,
    });
  }

  /**
   * Everything between "drafted" and "sent," in the order it will actually
   * happen — for the Automation page's "when does this go out" question.
   * Two genuinely different kinds of row, kept separate rather than forced
   * into one fake timestamp column:
   *  - `queued`: already drafted, sitting in the email-send queue with no
   *    delay — sends within moments, in the order queued (see `upcoming`
   *    above for why `createdAt`, not `scheduledAt`).
   *  - `waiting`: not drafted yet, counting down a real BullMQ delayed-job
   *    timer (`PipelineState.nextActionAt`, set precisely in
   *    SequencerService.scheduleWait) before the next step's draft is
   *    triggered — this is the only row type with a genuine future clock
   *    time.
   */
  @Get("send-queue")
  async sendQueue(@CurrentUser() user: JwtClaims) {
    const [queued, waitingStates] = await Promise.all([
      this.prisma.emailMessage.findMany({
        where: { status: "QUEUED", lead: { orgId: user.orgId } },
        include: { lead: { select: { id: true, companyName: true } }, account: { select: { address: true } } },
        orderBy: { createdAt: "asc" },
        take: 100,
      }),
      this.prisma.pipelineState.findMany({
        where: {
          stage: { in: WAITING_STAGES },
          lead: { orgId: user.orgId },
        },
        include: { lead: { select: { id: true, companyName: true } } },
        orderBy: { nextActionAt: "asc" },
        take: 100,
      }),
    ]);

    return {
      queued,
      waiting: waitingStates.map((s) => ({
        leadId: s.leadId,
        lead: s.lead,
        nextStep: NEXT_STEP_FOR_WAITING_STAGE[s.stage],
        nextActionAt: s.nextActionAt,
      })),
    };
  }
}
