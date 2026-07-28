import { Body, Controller, Param, Patch, UseGuards } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { InternalAuthGuard } from "../common/guards/internal-auth.guard";
import { ExtractionRunStatus } from "@prisma/client";

/** Called by the Claude lead-gen agent as it makes progress and when it finishes (Part C1). */
@Controller("extraction-runs")
@UseGuards(InternalAuthGuard)
export class ExtractionRunsController {
  constructor(private readonly prisma: PrismaService) {}

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body()
    body: Partial<{
      leadsFound: number;
      leadsVerified: number;
      duplicatesSkipped: number;
      status: ExtractionRunStatus;
      finishedAt: string;
      error: string;
    }>,
  ) {
    // Fields are copied across explicitly rather than spread — spreading the
    // request body into Prisma's `data` would let any caller holding the
    // internal token write any column on the row.
    return this.prisma.extractionRun.update({
      where: { id },
      data: {
        leadsFound: body.leadsFound,
        leadsVerified: body.leadsVerified,
        duplicatesSkipped: body.duplicatesSkipped,
        status: body.status,
        finishedAt: body.finishedAt ? new Date(body.finishedAt) : undefined,
        error: body.error?.slice(0, 2000),
      },
    });
  }
}
