import { Controller, Get, UseGuards } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims } from "@leadgen/types";

/**
 * Read endpoints backing the Sequences dashboard tab (Part F1): the Email #3
 * approval queue and the upcoming-send calendar. Mutations (approve/edit/
 * reject) already exist on `POST /leads/:id/approve-email` — kept there since
 * they operate on a specific lead, not the sequence-wide view.
 */
@Controller("sequences")
@UseGuards(JwtAuthGuard)
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
      orderBy: { scheduledAt: "asc" },
      take: 100,
    });
  }
}
