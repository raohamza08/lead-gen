import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PipelineStage } from "@leadgen/types";
import { PrismaService } from "../common/prisma/prisma.service";
import { CreateLeadDto } from "./dto/create-lead.dto";
import { ReviewNoteDto } from "./dto/review-note.dto";
import { QueryLeadsDto } from "./dto/query-leads.dto";
import { ApproveEmailAction, ApproveEmailDto } from "./dto/approve-email.dto";
import { isValidTransition } from "./pipeline-transitions";
import { SequencerService } from "../sequencer/sequencer.service";
import { SyncService } from "../sync/sync.service";

export interface CreateLeadResult {
  status: "created" | "duplicate";
  leadId?: string;
}

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sequencer: SequencerService,
    private readonly sync: SyncService,
  ) {}

  /**
   * Tier-1 dedup + insert (Part C2). Relies on the Postgres unique constraints
   * on (orgId, websiteDomain) and (orgId, email) rather than a SELECT-then-INSERT
   * race — under concurrent extraction workers, the DB is the single source of
   * truth for uniqueness, not an application-level check.
   */
  async createVerified(orgId: string, dto: CreateLeadDto): Promise<CreateLeadResult> {
    const websiteDomain = extractDomain(dto.website);

    try {
      const lead = await this.prisma.$transaction(async (tx) => {
        const created = await tx.lead.create({
          data: {
            orgId,
            runId: dto.runId,
            filterId: dto.filterId,
            companyName: dto.companyName,
            website: dto.website,
            websiteDomain,
            linkedinUrl: dto.linkedinUrl,
            contactName: dto.contactName,
            jobTitle: dto.jobTitle,
            email: dto.email,
            phone: dto.phone,
            industry: dto.industry,
            subNiche: dto.subNiche,
            country: dto.country,
            city: dto.city,
            companySize: dto.companySize,
            revenueBand: dto.revenueBand,
            employeeCount: dto.employeeCount,
            techStack: (dto.techStack ?? []) as Prisma.InputJsonValue,
            businessModel: dto.businessModel,
            b2bOrB2c: dto.b2bOrB2c,
            businessDescription: dto.businessDescription,
            currentCrm: dto.currentCrm,
            verifiedEmail: dto.verifiedEmail ?? false,
            verifiedLinkedin: dto.verifiedLinkedin ?? false,
            verifiedWebsite: dto.verifiedWebsite ?? false,
          },
        });

        await tx.leadScore.create({
          data: {
            leadId: created.id,
            leadScore: dto.leadScore ?? 0,
            confidenceScore: dto.confidenceScore ?? 0,
            aiOpportunityScore: dto.aiOpportunityScore ?? 0,
            automationScore: dto.automationScore ?? 0,
            crmReadinessScore: dto.crmReadinessScore ?? 0,
            websiteQualityScore: dto.websiteQualityScore ?? 0,
            fitReason: dto.fitReason,
            suggestedServices: dto.suggestedServices,
            expectedValue: dto.expectedValue,
          },
        });

        await tx.pipelineState.create({
          data: { leadId: created.id, stage: PipelineStage.NEW_LEAD },
        });

        return created;
      });

      // Fire-and-forget sync to Sheets + ClickUp (Part C4/C5). Failures here are
      // retried by the sync queue, never block the lead from existing.
      this.sync.onLeadCreated(lead.id).catch((err) =>
        this.logger.warn(`Sync dispatch failed for lead ${lead.id}: ${(err as Error).message}`),
      );

      return { status: "created", leadId: lead.id };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        // Unique constraint hit on (orgId, websiteDomain) or (orgId, email) — Tier-1 duplicate.
        return { status: "duplicate" };
      }
      throw err;
    }
  }

  async findAll(orgId: string, query: QueryLeadsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    const where: Prisma.LeadWhereInput = {
      orgId,
      industry: query.industry,
      country: query.country,
      assignedUserId: query.assignedUserId,
      companyName: query.search ? { contains: query.search, mode: "insensitive" } : undefined,
      pipelineState: query.stage ? { stage: query.stage } : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        include: { score: true, pipelineState: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(orgId: string, id: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, orgId },
      include: {
        score: true,
        reviewNote: true,
        pipelineState: true,
        emailMessages: { orderBy: { sequenceStep: "asc" } },
        linkedinActivities: true,
      },
    });
    if (!lead) throw new NotFoundException("Lead not found");
    return lead;
  }

  async updateReviewNote(orgId: string, id: string, reviewerId: string, dto: ReviewNoteDto) {
    await this.assertOwnership(orgId, id);
    return this.prisma.reviewNote.upsert({
      where: { leadId: id },
      create: { leadId: id, reviewerId, ...dto },
      update: { reviewerId, ...dto },
    });
  }

  /**
   * Stage transitions are validated against the state machine (Part C6) and
   * side-effect into the sequencer for the stages that trigger automation
   * (e.g. entering READY_FOR_OUTREACH enqueues Email #1).
   */
  async advanceStage(orgId: string, id: string, toStage: PipelineStage) {
    const lead = await this.assertOwnership(orgId, id);
    const current = await this.prisma.pipelineState.findUniqueOrThrow({ where: { leadId: id } });

    if (!isValidTransition(current.stage as PipelineStage, toStage)) {
      throw new BadRequestException(`Cannot move lead from ${current.stage} to ${toStage}`);
    }

    const updated = await this.prisma.pipelineState.update({
      where: { leadId: id },
      data: { stage: toStage, enteredStageAt: new Date() },
    });

    await this.prisma.lead.update({ where: { id }, data: { lastActivityAt: new Date() } });

    // Keep ClickUp's card in sync with system-driven stage changes (Part C5).
    this.sync.onStageChanged(id, toStage).catch((err) =>
      this.logger.warn(`ClickUp sync failed for lead ${id}: ${(err as Error).message}`),
    );

    await this.sequencer.onStageEntered(lead.id, toStage);

    return updated;
  }

  async approveEmail(orgId: string, leadId: string, dto: ApproveEmailDto) {
    await this.assertOwnership(orgId, leadId);
    const message = await this.prisma.emailMessage.findFirst({
      where: { id: dto.emailMessageId, leadId },
    });
    if (!message) throw new NotFoundException("Email draft not found");

    if (dto.action === ApproveEmailAction.REJECT) {
      return this.prisma.emailMessage.update({
        where: { id: message.id },
        data: { status: "CANCELLED" },
      });
    }

    const finalSubject = dto.action === ApproveEmailAction.EDIT ? dto.editedSubject ?? message.subject : message.subject;
    const finalBody = dto.action === ApproveEmailAction.EDIT ? dto.editedBodyHtml ?? message.bodyHtml : message.bodyHtml;
    const generatedBy = dto.action === ApproveEmailAction.EDIT ? "HUMAN_EDIT" : message.generatedBy;

    const approved = await this.prisma.emailMessage.update({
      where: { id: message.id },
      data: { subject: finalSubject, bodyHtml: finalBody, generatedBy, status: "QUEUED" },
    });

    await this.sequencer.enqueueApprovedSend(approved.id);
    return approved;
  }

  /**
   * Called by the Gemini agent (via the internal-token-guarded endpoint) once
   * Email #3 is drafted. Defaults to PENDING_APPROVAL — auto-send is opt-in per
   * org (Part I2/I6: unattended AI-drafted sends are the single highest launch
   * risk, so the safer state is the default).
   */
  async receiveEmail3Draft(leadId: string, dto: { subject: string; bodyHtml: string; rationale: unknown }) {
    const lead = await this.prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: lead.orgId } });
    const autoSendEnabled = Boolean((org.settings as Record<string, unknown>)?.autoSendEnabled);

    const message = await this.prisma.emailMessage.create({
      data: {
        leadId,
        sequenceStep: 3,
        subject: dto.subject,
        bodyHtml: dto.bodyHtml,
        rationale: dto.rationale as Prisma.InputJsonValue,
        generatedBy: "GEMINI",
        status: autoSendEnabled ? "QUEUED" : "PENDING_APPROVAL",
      },
    });

    await this.prisma.pipelineState.update({
      where: { leadId },
      data: { stage: PipelineStage.PERSONALIZED_PITCH, enteredStageAt: new Date() },
    });
    await this.sync.onStageChanged(leadId, PipelineStage.PERSONALIZED_PITCH);

    if (autoSendEnabled) {
      await this.sequencer.enqueueApprovedSend(message.id);
    }

    return message;
  }

  private async assertOwnership(orgId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId } });
    if (!lead) throw new NotFoundException("Lead not found");
    return lead;
  }
}

function extractDomain(website?: string): string | undefined {
  if (!website) return undefined;
  try {
    const url = new URL(website.startsWith("http") ? website : `https://${website}`);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return website.toLowerCase();
  }
}
