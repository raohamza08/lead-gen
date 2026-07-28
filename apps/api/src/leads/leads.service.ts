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

    // Tier-2 duplicate check, ahead of the insert.
    //
    // The unique constraints below cover domain and email only, so the same
    // company arriving under a different domain (a .co.uk vs .com, a rebrand)
    // or with no email at all would insert cleanly as a second record. The spec
    // requires matching on company name and LinkedIn URL as well, and neither
    // can be a DB unique constraint: company names are legitimately similar
    // across orgs, and a null LinkedIn URL must not collide with another null.
    const existing = await this.findExistingDuplicate(orgId, dto, websiteDomain);
    if (existing) {
      this.logger.debug(`Duplicate lead rejected for org ${orgId}: matched ${existing.reason}`);
      return { status: "duplicate" };
    }

    try {
      const lead = await this.prisma.$transaction(async (tx) => {
        const created = await tx.lead.create({
          data: {
            orgId,
            runId: dto.runId,
            filterId: dto.filterId,
            companyName: dto.companyName,
            // Written on insert so the next duplicate check can compare against
            // it. A lead saved without these is invisible to tier-2 dedup.
            companyNameKey: normaliseCompanyName(dto.companyName),
            linkedinSlug: normaliseLinkedin(dto.linkedinUrl),
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
            contactLinkedinUrl: dto.contactLinkedinUrl,
            estimatedRevenue: dto.estimatedRevenue,
            websitePlatform: dto.websitePlatform,
            automationTools: (dto.automationTools ?? []) as Prisma.InputJsonValue,
            aiUsage: dto.aiUsage,
            growthSignals: (dto.growthSignals ?? []) as Prisma.InputJsonValue,
            painPoints: dto.painPoints,
            aiOpportunities: dto.aiOpportunities,
            automationOpportunities: dto.automationOpportunities,
            researchEvidence: dto.researchEvidence,
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
            businessFitScore: dto.businessFitScore,
            buyingIntentScore: dto.buyingIntentScore,
            budgetScore: dto.budgetScore,
            technologyGapScore: dto.technologyGapScore,
            decisionMakerAccessScore: dto.decisionMakerAccessScore,
            leadPriorityScore: dto.leadPriorityScore,
            fitReason: dto.fitReason,
            suggestedServices: dto.suggestedServices,
            expectedValue: dto.expectedValue,
            priority: dto.priority,
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

  /**
   * Tier-2 duplicate detection (Part C2), covering the identities the database
   * unique constraints cannot.
   *
   * The constraints handle exact domain and exact email. These three cases slip
   * past them:
   *   - the same company under a different domain (.com vs .co.uk, a rebrand),
   *   - a company with no email, where the email constraint never applies,
   *   - a normalised LinkedIn URL that differs only by trailing slash or case.
   *
   * Company name is compared case-insensitively after stripping punctuation and
   * common suffixes, so "Acme Ltd." and "acme limited" collapse together. This
   * is still exact-after-normalisation, not fuzzy — a genuine similarity layer
   * (trigram or embedding) is the next step, and is deliberately not faked here.
   */
  private async findExistingDuplicate(
    orgId: string,
    dto: CreateLeadDto,
    websiteDomain?: string,
  ): Promise<{ reason: string } | null> {
    const checks: { reason: string; where: Prisma.LeadWhereInput }[] = [];

    if (websiteDomain) checks.push({ reason: "website domain", where: { orgId, websiteDomain } });
    if (dto.email) {
      checks.push({ reason: "email", where: { orgId, email: { equals: dto.email, mode: "insensitive" } } });
    }

    // Both compare against the PERSISTED normalised columns. Comparing against
    // the raw columns would match nothing the raw value wouldn't already have
    // matched, making the normalisation pointless. Exact equality, not
    // `contains` — `contains` on a slug makes "company/acme" match
    // "company/acme-health", merging two different companies.
    const linkedin = normaliseLinkedin(dto.linkedinUrl);
    if (linkedin) checks.push({ reason: "LinkedIn URL", where: { orgId, linkedinSlug: linkedin } });

    const name = normaliseCompanyName(dto.companyName);
    if (name) checks.push({ reason: "company name", where: { orgId, companyNameKey: name } });

    for (const check of checks) {
      const hit = await this.prisma.lead.findFirst({ where: check.where, select: { id: true } });
      if (hit) return { reason: check.reason };
    }
    return null;
  }
}

/** Strips scheme, host, trailing slash and case so cosmetically different
 *  LinkedIn URLs for the same company compare equal. Exported for testing —
 *  these two functions are the whole of tier-2 dedup, and a bug in either means
 *  contacting the same company twice. */
export function normaliseLinkedin(url?: string): string | undefined {
  if (!url) return undefined;
  const slug = url
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^([a-z]{2,3}\.)?linkedin\.com\//, "")
    .replace(/\/+$/, "")
    .trim();
  return slug || undefined;
}

/** Lower-cases and strips punctuation plus common legal suffixes, so
 *  "Acme Ltd." and "acme limited" normalise to the same string. */
export function normaliseCompanyName(name?: string): string | undefined {
  if (!name) return undefined;
  const cleaned = name
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\b(ltd|limited|llc|inc|incorporated|corp|corporation|gmbh|bv|plc|pty|co)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || undefined;
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
