import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { CreateCaseStudyDto } from "./dto/create-case-study.dto";

interface ReviewResult {
  usable: boolean;
  title: string;
  summary: string;
  metrics: Record<string, unknown>;
  industry: string;
  reviewNotes: string;
  completed: boolean;
  stopReason: string | null;
}

/**
 * Case studies are the only place in the 5-email sequence allowed to name the
 * sending company and cite a real result (Email 3, "Proof") — see
 * sequencer.service.ts's dispatchEmailDraft. Every submission is reviewed by
 * the AI worker synchronously on create, so what lands in Settings is already
 * either usable (READY) or flagged for the operator to fix, never a raw,
 * unreviewed story that could reach a real send.
 */
@Injectable()
export class CaseStudiesService {
  private readonly logger = new Logger(CaseStudiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  findAll(orgId: string) {
    return this.prisma.caseStudy.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(orgId: string, dto: CreateCaseStudyDto) {
    const review = await this.review(orgId, dto);

    if (!review) {
      // AI worker unreachable — save what the operator wrote so the work
      // isn't lost, but flagged so it can never be picked up by a real send
      // (see the sequencer's `status: READY` filter) until someone retries.
      return this.prisma.caseStudy.create({
        data: {
          orgId,
          title: dto.title || "(untitled)",
          summary: dto.rawStory,
          metrics: {},
          industry: dto.submittedIndustry,
          status: "NEEDS_ATTENTION",
          rawStory: dto.rawStory,
          submittedIndustry: dto.submittedIndustry,
          reviewNotes: "AI review could not run — the AI workers service was unreachable. Delete and resubmit to retry.",
        },
      });
    }

    return this.prisma.caseStudy.create({
      data: {
        orgId,
        title: review.title || dto.title || "(untitled)",
        summary: review.summary || dto.rawStory,
        metrics: (review.metrics ?? {}) as Prisma.InputJsonValue,
        industry: review.industry || dto.submittedIndustry,
        status: review.usable && review.completed ? "READY" : "NEEDS_ATTENTION",
        rawStory: dto.rawStory,
        submittedIndustry: dto.submittedIndustry,
        reviewNotes: review.reviewNotes || (review.completed ? "" : `Review did not complete: ${review.stopReason ?? "unknown reason"}`),
      },
    });
  }

  /** Re-runs the AI review against the original story — for a case study
   *  stuck in NEEDS_ATTENTION after a worker outage, or after the prompt has
   *  since been edited in Settings' Agent prompts page. */
  async retry(orgId: string, id: string) {
    const existing = await this.prisma.caseStudy.findFirst({ where: { id, orgId } });
    if (!existing) return null;

    const review = await this.review(orgId, {
      title: existing.title,
      rawStory: existing.rawStory,
      submittedIndustry: existing.submittedIndustry,
    });
    if (!review) return existing;

    return this.prisma.caseStudy.update({
      where: { id },
      data: {
        title: review.title || existing.title,
        summary: review.summary || existing.summary,
        metrics: (review.metrics ?? {}) as Prisma.InputJsonValue,
        industry: review.industry || existing.submittedIndustry,
        status: review.usable && review.completed ? "READY" : "NEEDS_ATTENTION",
        reviewNotes: review.reviewNotes || (review.completed ? "" : `Review did not complete: ${review.stopReason ?? "unknown reason"}`),
      },
    });
  }

  async remove(orgId: string, id: string) {
    const res = await this.prisma.caseStudy.deleteMany({ where: { id, orgId } });
    return { deleted: res.count };
  }

  private async review(orgId: string, dto: CreateCaseStudyDto): Promise<ReviewResult | null> {
    const aiWorkersUrl = this.config.get<string>("AI_WORKERS_URL", "http://localhost:8000");
    try {
      const res = await fetch(`${aiWorkersUrl}/case-study/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          title: dto.title || null,
          rawStory: dto.rawStory,
          submittedIndustry: dto.submittedIndustry,
        }),
        // A single Claude CLI call, same budget as /optimisation/run.
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`worker responded ${res.status}`);
      return (await res.json()) as ReviewResult;
    } catch (err) {
      this.logger.error(`Case study review failed for org ${orgId}: ${(err as Error).message}`);
      return null;
    }
  }
}
