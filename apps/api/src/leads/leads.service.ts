import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PipelineStage } from "@leadgen/types";
import { PrismaService } from "../common/prisma/prisma.service";
import { CreateLeadDto } from "./dto/create-lead.dto";
import { CreateManualLeadDto } from "./dto/create-manual-lead.dto";
import { ReviewNoteDto } from "./dto/review-note.dto";
import { ApplyEnrichmentDto } from "./dto/apply-enrichment.dto";
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
    private readonly config: ConfigService,
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

    // A lead's campaign is inferred from the filter that found it: campaigns
    // point at a filter, not the other way round, so this is the only place
    // that link can be made. Without it, campaign performance reads zero
    // regardless of activity, no matter how many leads the filter produces.
    const campaign = dto.filterId
      ? await this.prisma.campaign.findFirst({ where: { orgId, filterId: dto.filterId } })
      : null;

    try {
      const lead = await this.prisma.$transaction(async (tx) => {
        const created = await tx.lead.create({
          data: {
            orgId,
            runId: dto.runId,
            filterId: dto.filterId,
            campaignId: campaign?.id,
            companyName: dto.companyName,
            sourceLayer: dto.sourceLayer,
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
            swotAnalysis: (dto.swotAnalysis ?? {}) as Prisma.InputJsonValue,
            competitors: (dto.competitors ?? []) as Prisma.InputJsonValue,
            recentNews: (dto.recentNews ?? []) as Prisma.InputJsonValue,
            marketingStack: (dto.marketingStack ?? []) as Prisma.InputJsonValue,
            uxIssues: dto.uxIssues,
            seoIssues: dto.seoIssues,
            buyerPersona: dto.buyerPersona,
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
            digitalMaturityScore: dto.digitalMaturityScore,
            aiReadinessScore: dto.aiReadinessScore,
            automationOpportunityScore: dto.automationOpportunityScore,
            authorityScore: dto.authorityScore,
            engagementScore: dto.engagementScore,
            projectComplexity: dto.projectComplexity,
            fitReason: dto.fitReason,
            suggestedServices: dto.suggestedServices,
            expectedValue: dto.expectedValue,
            priority: dto.priority,
          },
        });

        await tx.pipelineState.create({
          data: { leadId: created.id, stage: dto.initialStage ?? PipelineStage.NEW_LEAD },
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
        include: {
          score: true,
          pipelineState: true,
          // Cheap summaries for the pipeline board: the single most recent
          // agent touch and email attempt, not the full history — a card
          // needs "what happened last", the lead detail page has the trail.
          agentRuns: { orderBy: { startedAt: "desc" }, take: 1 },
          emailMessages: {
            orderBy: { sequenceStep: "desc" },
            take: 1,
            include: { events: { where: { eventType: "OPENED" }, orderBy: { occurredAt: "desc" }, take: 1 } },
          },
        },
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
        agentReview: true,
        pipelineState: true,
        emailMessages: {
          orderBy: { sequenceStep: "asc" },
          include: { events: { orderBy: { occurredAt: "asc" } } },
        },
        linkedinActivities: true,
        // Full trail, oldest first, so the detail page can render it as a
        // timeline of what the fleet actually did to this specific lead.
        agentRuns: { orderBy: { startedAt: "asc" } },
      },
    });
    if (!lead) throw new NotFoundException("Lead not found");
    return lead;
  }

  /**
   * Permanently deletes a lead and everything under it — score, review note,
   * pipeline state, sent/queued email history, LinkedIn activity. Unlike
   * niche-filter or email-account deletion elsewhere in this app, there is no
   * "detach and keep" option here: the lead itself is what's being removed,
   * so its history goes with it. AuditLog rows are kept with leadId set to
   * null (Prisma's `onDelete: SetNull` on that relation) so accountability
   * history survives; everything else cascades.
   */
  async remove(orgId: string, id: string) {
    await this.assertOwnership(orgId, id);
    await this.sequencer.cancelWaitTimer(id);
    await this.prisma.lead.delete({ where: { id } });
    return { deleted: true };
  }

  /** All leads for the org as CSV, for the "download all leads" export on /leads. */
  async exportCsv(orgId: string): Promise<string> {
    const leads = await this.prisma.lead.findMany({
      where: { orgId },
      include: { score: true, pipelineState: true },
      orderBy: { createdAt: "desc" },
    });

    const columns = [
      "Company", "Website", "Industry", "Country", "City",
      "Contact name", "Job title", "Email", "Phone",
      "Lead score", "AI opportunity score", "Stage", "Created at",
    ];

    // Excel and most spreadsheet tools choke on a bare comma/quote/newline in
    // a field without quoting, so every value is quoted and internal quotes
    // are doubled per RFC 4180 rather than only quoting when "necessary".
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

    const rows = leads.map((lead) =>
      [
        lead.companyName,
        lead.website,
        lead.industry,
        lead.country,
        lead.city,
        lead.contactName,
        lead.jobTitle,
        lead.email,
        lead.phone,
        lead.score?.leadScore,
        lead.score?.aiOpportunityScore,
        lead.pipelineState?.stage,
        lead.createdAt.toISOString(),
      ]
        .map(escape)
        .join(","),
    );

    // \r\n per RFC 4180, and a leading BOM so Excel on Windows detects UTF-8
    // instead of guessing the system codepage and mangling non-ASCII names.
    return "﻿" + [columns.map(escape).join(","), ...rows].join("\r\n");
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
   * Called by the AI workers once the manual-lead enrichment pipeline
   * finishes (lead_verification/company_intelligence/website_audit/
   * buyer_intelligence/ai_opportunity/lead_scoring/agent_review). Unlike
   * createVerified, this UPDATES a lead that already exists rather than
   * inserting one, so only the keys actually present get written — a
   * degraded agent must leave the existing value alone, not null it out.
   */
  async applyEnrichment(orgId: string, id: string, dto: ApplyEnrichmentDto) {
    await this.assertOwnership(orgId, id);
    const { agentReview, ...fields } = dto;
    const values = fields as Record<string, unknown>;

    const leadPatch: Record<string, unknown> = {};
    for (const key of LEAD_ENRICHMENT_KEYS) {
      if (values[key] !== undefined) leadPatch[key] = values[key];
    }

    const scorePatch: Record<string, unknown> = {};
    for (const key of SCORE_ENRICHMENT_KEYS) {
      if (values[key] !== undefined) scorePatch[key] = values[key];
    }

    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(leadPatch).length) {
        await tx.lead.update({ where: { id }, data: leadPatch as Prisma.LeadUpdateInput });
      }
      if (Object.keys(scorePatch).length) {
        await tx.leadScore.upsert({
          where: { leadId: id },
          // A manual lead already has a zeroed LeadScore row from createManual,
          // so this branch is mostly belt-and-braces for the rare case the
          // enrichment pipeline runs before that row exists for some reason.
          create: {
            leadId: id,
            leadScore: 0,
            confidenceScore: 0,
            aiOpportunityScore: 0,
            automationScore: 0,
            crmReadinessScore: 0,
            websiteQualityScore: 0,
            ...scorePatch,
          } as Prisma.LeadScoreUncheckedCreateInput,
          update: scorePatch as Prisma.LeadScoreUpdateInput,
        });
      }
      if (agentReview) {
        await tx.agentReview.upsert({
          where: { leadId: id },
          create: { leadId: id, ...agentReview },
          update: { ...agentReview },
        });
      }
      await tx.lead.update({ where: { id }, data: { lastActivityAt: new Date() } });
    });

    return { updated: true };
  }

  /**
   * Triggers the full research/verification/scoring pipeline against a lead
   * that already exists. Runs automatically once when a manual lead is
   * created (see createManual); exposed here too so a lead added before this
   * existed — or whose enrichment run failed — can be re-run without
   * re-entering it.
   */
  async requestEnrichment(orgId: string, leadId: string) {
    await this.assertOwnership(orgId, leadId);
    try {
      await this.dispatchEnrichment(orgId, leadId);
    } catch (err) {
      throw new ServiceUnavailableException(
        `Could not reach the AI workers: ${(err as Error).message}`,
      );
    }
    return { accepted: true };
  }

  private async dispatchEnrichment(orgId: string, leadId: string) {
    const aiWorkersUrl = this.config.get<string>("AI_WORKERS_URL", "http://localhost:8000");
    await fetch(`${aiWorkersUrl}/lead-gen/enrich`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId, orgId }),
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
      // previousStage records where this lead just came from, so a single
      // "back" step can undo a wrong drag or re-enter a stage whose
      // automation failed (e.g. Email #1 with no mailbox configured yet)
      // without a separate retry mechanism.
      data: { stage: toStage, previousStage: current.stage, enteredStageAt: new Date() },
    });

    await this.prisma.lead.update({ where: { id }, data: { lastActivityAt: new Date() } });

    // Keep ClickUp's card in sync with system-driven stage changes (Part C5).
    this.sync.onStageChanged(id, toStage).catch((err) =>
      this.logger.warn(`ClickUp sync failed for lead ${id}: ${(err as Error).message}`),
    );

    await this.sequencer.onStageEntered(lead.id, toStage);

    return updated;
  }

  /**
   * Moves a lead back to the stage it was in immediately before its current
   * one. Swaps stage<->previousStage rather than consuming the history, so
   * back-then-forward-then-back keeps working like a toggle instead of
   * dead-ending after one use.
   *
   * Deliberately does NOT call sequencer.onStageEntered — going back is a
   * correction, not a forward action, and re-firing it could send a second
   * copy of an email that already went out. It does cancel any pending wait
   * timer, since rewinding out of a WAITING_* stage must not leave a stale
   * BullMQ job that fires against a stage the lead has since left.
   */
  async moveBack(orgId: string, id: string) {
    await this.assertOwnership(orgId, id);
    const current = await this.prisma.pipelineState.findUniqueOrThrow({ where: { leadId: id } });

    if (!current.previousStage) {
      throw new BadRequestException("This lead has no previous stage to go back to");
    }

    await this.sequencer.cancelWaitTimer(id);

    const updated = await this.prisma.pipelineState.update({
      where: { leadId: id },
      data: { stage: current.previousStage, previousStage: current.stage, enteredStageAt: new Date() },
    });

    await this.prisma.lead.update({ where: { id }, data: { lastActivityAt: new Date() } });

    this.sync.onStageChanged(id, updated.stage as PipelineStage).catch((err) =>
      this.logger.warn(`ClickUp sync failed for lead ${id}: ${(err as Error).message}`),
    );

    return updated;
  }

  /** Retries an email that failed to send — e.g. it failed because no mailbox
   *  was configured yet, and one has since been added. */
  async resendEmail(orgId: string, leadId: string, emailMessageId: string) {
    await this.assertOwnership(orgId, leadId);
    const message = await this.prisma.emailMessage.findFirst({ where: { id: emailMessageId, leadId } });
    if (!message) throw new NotFoundException("Email message not found");
    await this.sequencer.resendFailedMessage(emailMessageId);
    return { resent: true };
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

  /** Fire-and-forget hand-off to the LinkedInAgent — mirrors requestGeminiDraft
   *  in SequencerService, but triggered manually from a lead's detail page
   *  rather than automatically on stage entry, since LinkedIn outreach stays
   *  human-driven end to end. */
  async requestLinkedinDraft(orgId: string, leadId: string) {
    await this.assertOwnership(orgId, leadId);
    const aiWorkersUrl = this.config.get<string>("AI_WORKERS_URL", "http://localhost:8000");
    try {
      await fetch(`${aiWorkersUrl}/linkedin/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, orgId }),
      });
    } catch (err) {
      throw new ServiceUnavailableException(
        `Could not reach the AI workers: ${(err as Error).message}`,
      );
    }
    return { accepted: true };
  }

  /** Called by the LinkedInAgent (via the internal-token-guarded endpoint)
   *  once copy is drafted. There's no unique constraint tying one
   *  LinkedinActivity to one lead (sequencer.ts's sendEmail1 creates it
   *  lazily too), so this finds-or-creates rather than relying on upsert. */
  async receiveLinkedinDraft(leadId: string, messages: unknown) {
    await this.prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    const existing = await this.prisma.linkedinActivity.findFirst({ where: { leadId } });
    if (existing) {
      await this.prisma.linkedinActivity.update({
        where: { id: existing.id },
        data: { draftMessages: messages as Prisma.InputJsonValue },
      });
    } else {
      await this.prisma.linkedinActivity.create({
        data: { leadId, draftMessages: messages as Prisma.InputJsonValue },
      });
    }
    return { saved: true };
  }

  private async assertOwnership(orgId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, orgId } });
    if (!lead) throw new NotFoundException("Lead not found");
    return lead;
  }

  /**
   * Creates a lead entered by hand in the dashboard.
   *
   * Runs the same duplicate checks as the agent path, so typing in a company
   * the agents already found is rejected rather than creating a second record
   * two people then contact independently.
   *
   * Starts at NEW_LEAD, not VERIFIED: nothing has checked the website, LinkedIn
   * or email yet. Marking it verified because a human typed it would put
   * unchecked addresses into the send queue, and a bounce damages the sending
   * reputation of every mailbox in the org.
   */
  async createManual(orgId: string, dto: CreateManualLeadDto): Promise<CreateLeadResult> {
    const websiteDomain = extractDomain(dto.website);

    const existing = await this.findExistingDuplicate(
      orgId,
      { companyName: dto.companyName, email: dto.email, linkedinUrl: dto.linkedinUrl },
      websiteDomain,
    );
    if (existing) {
      throw new ConflictException(
        `A lead for this company already exists (matched on ${existing.reason}).`,
      );
    }

    const lead = await this.prisma.$transaction(async (tx) => {
      const created = await tx.lead.create({
        data: {
          orgId,
          companyName: dto.companyName,
          sourceLayer: "MANUAL",
          companyNameKey: normaliseCompanyName(dto.companyName),
          linkedinSlug: normaliseLinkedin(dto.linkedinUrl),
          website: dto.website,
          websiteDomain,
          linkedinUrl: dto.linkedinUrl,
          contactName: dto.contactName,
          contactLinkedinUrl: dto.contactLinkedinUrl,
          jobTitle: dto.jobTitle,
          email: dto.email,
          phone: dto.phone,
          industry: dto.industry,
          country: dto.country,
          city: dto.city,
          employeeCount: dto.employeeCount,
          businessDescription: dto.businessDescription,
          campaignId: dto.campaignId,
          researchEvidence: dto.notes ? `[MANUAL ENTRY] ${dto.notes}` : "[MANUAL ENTRY]",
        },
      });

      // A score row is created so the lead sorts and renders alongside the
      // others; zeros are honest here — nothing has been assessed yet.
      await tx.leadScore.create({
        data: {
          leadId: created.id,
          leadScore: 0,
          confidenceScore: 0,
          aiOpportunityScore: 0,
          automationScore: 0,
          crmReadinessScore: 0,
          websiteQualityScore: 0,
          fitReason: "Added manually — not yet researched or scored.",
        },
      });

      await tx.pipelineState.create({
        data: { leadId: created.id, stage: PipelineStage.NEW_LEAD },
      });

      return created;
    });

    this.sync.onLeadCreated(lead.id).catch((err) =>
      this.logger.warn(`Sync dispatch failed for lead ${lead.id}: ${(err as Error).message}`),
    );

    // A hand-entered lead skips discovery, but everything discovery would
    // otherwise have triggered — verification, company/website/buyer
    // research, AI opportunity, scoring, and the AI's own review note — still
    // needs to happen. Fire-and-forget, same as the sync dispatch above: a
    // worker outage must not block the lead from being created.
    this.dispatchEnrichment(orgId, lead.id).catch((err) =>
      this.logger.warn(`Enrichment dispatch failed for lead ${lead.id}: ${(err as Error).message}`),
    );

    return { status: "created", leadId: lead.id };
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
    // "company" belongs here alongside "co": without it "Acme Co" and "Acme
    // Company" normalise differently and both get contacted. "group" and
    // "holdings" are deliberately NOT stripped — "Harbor Recruiting" and
    // "Harbor Recruiting Group" can be genuinely different entities, and a
    // false merge silently discards a real lead, which is worse than a
    // duplicate someone can spot.
    .replace(
      /\b(ltd|limited|llc|inc|incorporated|corp|corporation|company|gmbh|bv|plc|pty|co)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || undefined;
}

/** Which ApplyEnrichmentDto keys land on the Lead row versus the LeadScore
 *  row — the same split createVerified makes explicitly field-by-field, done
 *  here as a lookup since applyEnrichment's payload is a dynamic patch rather
 *  than a fixed literal. */
const LEAD_ENRICHMENT_KEYS = [
  "businessDescription", "currentCrm", "techStack", "growthSignals", "swotAnalysis",
  "competitors", "recentNews", "websitePlatform", "uxIssues", "seoIssues", "buyerPersona",
  "painPoints", "aiOpportunities", "automationOpportunities",
  "verifiedEmail", "verifiedLinkedin", "verifiedWebsite",
] as const;

const SCORE_ENRICHMENT_KEYS = [
  "leadScore", "confidenceScore", "aiOpportunityScore", "automationScore", "crmReadinessScore",
  "websiteQualityScore", "businessFitScore", "buyingIntentScore", "budgetScore", "technologyGapScore",
  "decisionMakerAccessScore", "leadPriorityScore", "digitalMaturityScore", "aiReadinessScore",
  "automationOpportunityScore", "authorityScore", "engagementScore", "projectComplexity",
  "fitReason", "suggestedServices", "expectedValue", "priority",
] as const;

function extractDomain(website?: string): string | undefined {
  if (!website) return undefined;
  try {
    const url = new URL(website.startsWith("http") ? website : `https://${website}`);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return website.toLowerCase();
  }
}
