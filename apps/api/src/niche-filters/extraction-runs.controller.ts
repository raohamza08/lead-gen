import { Body, Controller, Param, Patch, UseGuards } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { InternalAuthGuard } from "../common/guards/internal-auth.guard";
import { ExtractionRunStatus } from "@prisma/client";
import { RealtimeGateway } from "../realtime/realtime.gateway";

/** Called by the Claude lead-gen agent as it makes progress and when it finishes (Part C1). */
@Controller("extraction-runs")
@UseGuards(InternalAuthGuard)
export class ExtractionRunsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body()
    body: Partial<{
      leadsFound: number;
      leadsVerified: number;
      duplicatesSkipped: number;
      status: ExtractionRunStatus;
      finishedAt: string;
      error: string;
      priorityMix: Record<string, number>;
    }>,
  ) {
    // Fields are copied across explicitly rather than spread — spreading the
    // request body into Prisma's `data` would let any caller holding the
    // internal token write any column on the row.
    const run = await this.prisma.extractionRun.update({
      where: { id },
      data: {
        leadsFound: body.leadsFound,
        leadsVerified: body.leadsVerified,
        duplicatesSkipped: body.duplicatesSkipped,
        status: body.status,
        finishedAt: body.finishedAt ? new Date(body.finishedAt) : undefined,
        error: body.error?.slice(0, 2000),
        priorityMix: body.priorityMix,
      },
      include: { filter: { select: { orgId: true } } },
    });

    // Live "is Run now actually doing anything" feedback (Part: autonomous
    // system) — the worker calls this once per candidate attempt while
    // RUNNING, not only once at the very end, so the settings page can show
    // real progress instead of the button just going quiet for minutes.
    this.realtime.emitToOrg(run.filter.orgId, "extractionRun.progress", {
      runId: run.id,
      filterId: run.filterId,
      status: run.status,
      leadsFound: run.leadsFound,
      leadsVerified: run.leadsVerified,
      duplicatesSkipped: run.duplicatesSkipped,
      priorityMix: run.priorityMix,
      error: run.error,
    });

    return run;
  }
}
