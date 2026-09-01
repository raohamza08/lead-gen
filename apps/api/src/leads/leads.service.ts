import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { Prisma, NotificationCategory } from "@prisma/client";
import { LeadSourceLayer, PipelineStage } from "@leadgen/types";
import { PrismaService } from "../common/prisma/prisma.service";
import { CreateLeadDto } from "./dto/create-lead.dto";
import { CreateManualLeadDto } from "./dto/create-manual-lead.dto";
import { ReviewNoteDto } from "./dto/review-note.dto";
import { UpdateLeadContactDto } from "./dto/update-lead-contact.dto";
import { ApplyEnrichmentDto } from "./dto/apply-enrichment.dto";
import { QueryLeadsDto } from "./dto/query-leads.dto";
import { ApproveEmailAction, ApproveEmailDto } from "./dto/approve-email.dto";
import { isValidRewind, isValidTransition } from "./pipeline-transitions";
import { SequencerService } from "../sequencer/sequencer.service";
import { SyncService } from "../sync/sync.service";
import { AgentDispatchQueue } from "../common/queue/agent-dispatch.queue";
import { ImportEnrichmentQueue } from "../common/queue/import-enrichment.queue";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { SocialMediaService } from "../social-media/social-media.service";
import { mapRowToDto, parseCsvHeaders, parseCsvRows, suggestMapping } from "./lead-import-mapping";
import { EmailVerificationService } from "./email-verification.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ReportEmailDraftFailureDto } from "./dto/report-email-draft-failure.dto";
import { PreparationPipelineService } from "../preparation/preparation-pipeline.service";

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
    private readonly agentDispatch: AgentDispatchQueue,
    private readonly importEnrichment: ImportEnrichmentQueue,
    private readonly realtime: RealtimeGateway,
    private readonly socialMedia: SocialMediaService,
    private readonly emailVerification: EmailVerificationService,
    private readonly notifications: NotificationsService,
    private readonly preparationPipeline: PreparationPipelineService,
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
            personalEmail: dto.personalEmail,
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
          data: { leadId: created.id, stage: PipelineStage.READY_FOR_OUTREACH },
        });

        return created;
      });

      // Fire-and-forget sync to Sheets + ClickUp (Part C4/C5), which is also
      // the "lead.created" realtime emit's only choke point (SyncService's
      // own doc comment) — /leads picking it up is what makes new leads
      // appear live during a "Run now" extraction instead of needing a
      // manual refresh. Failures here are retried by the sync queue, never
      // block the lead from existing.
      this.sync.onLeadCreated(lead.id).catch((err) =>
        this.logger.warn(`Sync dispatch failed for lead ${lead.id}: ${(err as Error).message}`),
      );

      // Fire-and-forget, same pattern as the sync dispatch above — a NEW_LEAD
      // social automation (Part: Social Media Management) never blocks or
      // fails lead creation.
      this.socialMedia.runAutomationsForNewLead(lead).catch((err) =>
        this.logger.warn(`Social automation dispatch failed for lead ${lead.id}: ${(err as Error).message}`),
      );

      // A lead reaching here has already passed verification, so its email
      // is verified and outreach can start immediately — same call
      // updateContact/verifyEmail use to kick it off when a human or the
      // bulk verify action verifies one later instead.
      this.sequencer.maybeEnterOutreach(lead.id).catch((err) =>
        this.logger.warn(`Outreach entry failed for lead ${lead.id}: ${(err as Error).message}`),
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

  /** Lead Room dashboard card: total captured, split by where they came
   *  from, and how many are still waiting on research vs. already scored.
   *  "Scored" means a real score was produced (> 0) — a manual/email-sourced
   *  lead's zeroed LeadScore row from createManual doesn't count as scored,
   *  see insertManualLead's fitReason comment. */
  async getSourceBreakdown(orgId: string) {
    const [total, bySource, scored] = await Promise.all([
      this.prisma.lead.count({ where: { orgId } }),
      this.prisma.lead.groupBy({ by: ["sourceLayer"], where: { orgId }, _count: { _all: true } }),
      this.prisma.lead.count({ where: { orgId, score: { leadScore: { gt: 0 } } } }),
    ]);

    return {
      total,
      bySource: Object.fromEntries(bySource.map((s) => [s.sourceLayer, s._count._all])),
      scored,
      awaitingResearch: total - scored,
    };
  }

  /**
   * Distinct industry/country values for the Lead Room filter dropdowns
   * (Part: performance audit, 2026-09-02) — previously these options were
   * derived client-side from the entire lead table already being held in
   * memory; now that the list is genuinely paginated, the page in view no
   * longer reliably contains every value that exists, so this is its own
   * small, cheap, indexed query instead.
   */
  async getFilterOptions(orgId: string) {
    const [industries, countries] = await Promise.all([
      this.prisma.lead.findMany({
        where: { orgId, industry: { not: null } },
        distinct: ["industry"],
        select: { industry: true },
        orderBy: { industry: "asc" },
      }),
      this.prisma.lead.findMany({
        where: { orgId, country: { not: null } },
        distinct: ["country"],
        select: { country: true },
        orderBy: { country: "asc" },
      }),
    ]);
    return {
      industries: industries.map((i) => i.industry as string),
      countries: countries.map((c) => c.country as string),
    };
  }

  /**
   * Count-only preview for the "Move N to Pipeline" button (Part:
   * performance audit, 2026-09-02) — reuses promoteToPipeline's exact WHERE
   * shape so the number shown is always exactly what that action would
   * actually do, without requiring the frontend to hold every un-promoted
   * lead in memory just to count a subset of them.
   */
  async getPromotePreviewCount(orgId: string, sourceLayer?: LeadSourceLayer): Promise<{ count: number }> {
    const count = await this.prisma.lead.count({
      where: { orgId, pipelineState: null, ...(sourceLayer ? { sourceLayer } : {}) },
    });
    return { count };
  }

  async findAll(orgId: string, query: QueryLeadsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    // Part: performance audit, 2026-09-02 — server-side, matching every
    // field the frontend used to search client-side over a fully-loaded
    // table (companyName/contactName/email/personalEmail/website), so
    // moving this to the server didn't narrow what a search actually finds.
    const searchOr: Prisma.LeadWhereInput[] | undefined = query.search
      ? (["companyName", "contactName", "email", "personalEmail", "website"] as const).map((field) => ({
          [field]: { contains: query.search, mode: "insensitive" as const },
        }))
      : undefined;

    const where: Prisma.LeadWhereInput = {
      orgId,
      industry: query.industry,
      country: query.country,
      assignedUserId: query.assignedUserId,
      sourceLayer: query.sourceLayer,
      ...(searchOr ? { OR: searchOr } : {}),
      pipelineState: query.stage ? { stage: query.stage } : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        // `select`, not `include`: the leads table and pipeline board (the
        // only two callers of this endpoint) render a fixed, small set of
        // fields — matches @leadgen/types' Lead interface exactly, which
        // already omits the AI-research columns (swotAnalysis, competitors,
        // recentNews, researchEvidence, growthSignals, and more). `include`
        // returns every scalar column on the base model regardless, so this
        // endpoint had been shipping all of that per row, per page load, for
        // data the list view never reads — measured at ~3.2KB/lead (651KB
        // for a 200-row page) before this change, most of it those columns.
        select: {
          id: true, orgId: true, runId: true, assignedUserId: true,
          companyName: true, sourceLayer: true, website: true, websiteDomain: true,
          linkedinUrl: true, contactName: true, jobTitle: true, email: true,
          personalEmail: true, phone: true, industry: true, subNiche: true,
          country: true, city: true, companySize: true, revenueBand: true,
          employeeCount: true, techStack: true, businessModel: true, b2bOrB2c: true,
          businessDescription: true, currentCrm: true, verifiedEmail: true,
          verifiedLinkedin: true, verifiedWebsite: true, possibleDuplicate: true,
          createdAt: true, lastActivityAt: true,
          // "Uploaded by X" (Part: Lead Upload Analytics, 2026-09-01) — null
          // for an AI-discovered lead.
          uploadedByUser: { select: { id: true, name: true } },
          score: true,
          pipelineState: true,
          // Cheap summaries for the pipeline board: the single most recent
          // agent touch and email attempt, not the full history — a card
          // needs "what happened last", the lead detail page has the trail.
          agentRuns: { orderBy: { startedAt: "desc" }, take: 1 },
          // Current retry/lock state per agent — typically 0-4 rows per lead,
          // drives the card's error banner + retry countdown (Part:
          // reliability overhaul, 2026-08-31).
          agentExecutions: true,
          // select, not include, here too — bodyHtml is the full rendered
          // email (every paragraph of real copy) and was going out for every
          // lead's most recent message on every list/board load; the list
          // view only ever reads the four fields below plus the open event.
          // verifiedOpenedAt (Part: 3-minute open verification, 2026-09-01)
          // is the one field to check for "opened" — the raw EmailEvent log
          // can include prefetch hits inside the 3-minute window that never
          // became a genuine open.
          emailMessages: {
            orderBy: { sequenceStep: "desc" },
            take: 1,
            select: {
              subject: true, status: true, sequenceStep: true, sentAt: true, verifiedOpenedAt: true,
              // WAITING_FOR_SCHEDULE's display-only countdown target (Part:
              // Preparation Pipeline / Sending Queue, 2026-09-01) — null once
              // the message leaves that status.
              scheduledAt: true,
            },
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
        agentExecutions: true,
        // "Uploaded by X · date" (Part: Lead Upload Analytics, 2026-09-01) —
        // null for an AI-discovered lead, which nobody uploaded.
        uploadedByUser: { select: { id: true, name: true } },
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

  /** Bulk version of `remove` for the Pipeline board's admin "clear a
   *  stage" action — every lead currently sitting in one column, gone at
   *  once. Same no-detach-and-keep, full-cascade semantics as a single
   *  delete; the only difference is scope. Still cancels each lead's own
   *  wait-timer job individually (not a bulk queue op) since BullMQ jobs
   *  are addressed by their own id, not queryable by leadId. */
  async removeByStage(orgId: string, stage: PipelineStage) {
    const leads = await this.prisma.lead.findMany({
      where: { orgId, pipelineState: { stage } },
      select: { id: true },
    });
    for (const lead of leads) {
      await this.sequencer.cancelWaitTimer(lead.id);
    }
    if (leads.length === 0) return { deleted: 0 };
    const result = await this.prisma.lead.deleteMany({ where: { id: { in: leads.map((l) => l.id) } } });
    return { deleted: result.count };
  }

  /** Bulk version of `remove` for Lead Room's admin "delete selected"
   *  action — an explicit, user-picked set of ids rather than everything
   *  matching a filter. Re-scoped to `orgId` here (not just trusted from
   *  the request) so a crafted id list from another org can't be used to
   *  delete leads outside the caller's own org. */
  async removeByIds(orgId: string, leadIds: string[]) {
    const leads = await this.prisma.lead.findMany({
      where: { orgId, id: { in: leadIds } },
      select: { id: true },
    });
    for (const lead of leads) {
      await this.sequencer.cancelWaitTimer(lead.id);
    }
    if (leads.length === 0) return { deleted: 0 };
    const result = await this.prisma.lead.deleteMany({ where: { id: { in: leads.map((l) => l.id) } } });
    return { deleted: result.count };
  }

  /**
   * Lead Room's "Move to Pipeline" action — the human-add paths
   * (createManual/importLeads/EmailHub addToLead, all via insertManualLead)
   * no longer create a PipelineState at creation time, so a lead sits here
   * with `pipelineState: null` until this runs. Oldest-first (createdAt
   * asc) so a partial batch (a `limit` less than the total candidates)
   * clears the longest-waiting leads first, not an arbitrary subset.
   * `sourceLayer` optionally scopes it to one channel (e.g. just the
   * EMAIL-sourced backlog); omitted means every un-promoted lead. `leadId`
   * promotes exactly one specific lead (the lead detail page's own
   * "Promote to Pipeline" action) — mutually sensible with sourceLayer/limit
   * but normally used alone.
   */
  async promoteToPipeline(orgId: string, options: { sourceLayer?: LeadSourceLayer; limit?: number; leadId?: string }) {
    const { sourceLayer, limit, leadId } = options;
    const candidates = await this.prisma.lead.findMany({
      where: {
        orgId,
        pipelineState: null,
        ...(leadId ? { id: leadId } : {}),
        ...(sourceLayer ? { sourceLayer } : {}),
      },
      orderBy: { createdAt: "asc" },
      ...(limit ? { take: limit } : {}),
      select: { id: true },
    });
    if (candidates.length === 0) return { promoted: 0 };

    await this.prisma.pipelineState.createMany({
      data: candidates.map((l) => ({ leadId: l.id, stage: PipelineStage.READY_FOR_OUTREACH })),
    });

    for (const { id } of candidates) {
      // Live Pipeline board update (ClickUp sync's own choke point for the
      // realtime emit), plus kicking off outreach immediately for any
      // promoted lead whose email happens to already be verified — most
      // Lead Room leads aren't yet, and stay parked in Ready until the
      // "Verify emails" action runs.
      this.sync.onStageChanged(id, PipelineStage.READY_FOR_OUTREACH).catch((err) =>
        this.logger.warn(`ClickUp sync failed for lead ${id}: ${(err as Error).message}`),
      );
      this.sequencer.maybeEnterOutreach(id).catch((err) =>
        this.logger.warn(`Outreach entry failed for lead ${id}: ${(err as Error).message}`),
      );
      // Company research is spent here, on promotion, rather than at
      // creation (Part: token reduction, 2026-08-29) — createManual/
      // importLeads' own enrichment dispatch no longer includes
      // company_intelligence (see registry.py's "manual_lead_enrichment"),
      // so every un-promoted Lead Room lead that never makes it here never
      // costs this call either.
      this.agentDispatch.add({ kind: "company_intelligence", leadId: id, orgId }).catch((err) =>
        this.logger.warn(`Company intelligence dispatch failed for lead ${id}: ${(err as Error).message}`),
      );
    }

    return { promoted: candidates.length };
  }

  /** All leads for the org as CSV, for the "download all leads" export on /leads. */
  async exportCsv(orgId: string): Promise<string> {
    const leads = await this.prisma.lead.findMany({
      where: { orgId },
      select: {
        companyName: true, website: true, industry: true, country: true, city: true,
        contactName: true, jobTitle: true, email: true, personalEmail: true, phone: true,
        createdAt: true,
        score: { select: { leadScore: true, aiOpportunityScore: true } },
        pipelineState: { select: { stage: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const columns = [
      "Company", "Website", "Industry", "Country", "City",
      "Contact name", "Job title", "Email", "Personal email", "Phone",
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
        lead.personalEmail,
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
    const note = await this.prisma.reviewNote.upsert({
      where: { leadId: id },
      create: { leadId: id, reviewerId, ...dto },
      update: { reviewerId, ...dto },
    });
    this.realtime.emitToOrg(orgId, "lead.updated", { leadId: id });
    return note;
  }

  /**
   * Fixes a lead's contact details after creation — most importantly, adding
   * an email to a hand-entered lead that was created without one and got
   * stuck unable to reach outreach (nothing dispatches Email 1 without a
   * verified email; see maybeEnterOutreach). The only self-service way to
   * recover a lead in that state, short of editing the database directly.
   */
  async updateContact(orgId: string, id: string, dto: UpdateLeadContactDto) {
    await this.assertOwnership(orgId, id);
    const lead = await this.prisma.lead.update({
      where: { id },
      data: {
        email: dto.email,
        contactName: dto.contactName,
        jobTitle: dto.jobTitle,
        phone: dto.phone,
        verifiedEmail: dto.verifiedEmail,
      },
    });
    this.realtime.emitToOrg(orgId, "lead.updated", { leadId: id });
    if (dto.verifiedEmail) {
      this.sequencer.maybeEnterOutreach(id).catch((err) =>
        this.logger.warn(`Outreach entry failed for lead ${id}: ${(err as Error).message}`),
      );
    }
    return lead;
  }

  /**
   * Re-checks one lead's email (NeverBounce, or the syntactic DEMO MODE
   * fallback if no key is configured — see EmailVerificationService) and
   * records the result. This is the real gate on outreach now that every
   * lead lands at READY_FOR_OUTREACH on creation: a lead that turns out
   * valid here starts drafting Email 1 immediately, no separate stage move
   * needed. The Pipeline board's "Verify emails" bulk action for the Ready
   * column is just this, looped client-side over every unverified card it
   * already has loaded — same live-progress pattern as Lead Room's bulk
   * delete, not a separate batch endpoint.
   */
  async verifyEmail(orgId: string, id: string) {
    const lead = await this.assertOwnership(orgId, id);
    if (!lead.email) {
      return { leadId: id, verifiedEmail: false, reason: "no email address on this lead" };
    }

    const result = await this.emailVerification.verify(lead.email);
    await this.prisma.lead.update({ where: { id }, data: { verifiedEmail: result.valid } });
    this.realtime.emitToOrg(orgId, "lead.updated", { leadId: id });

    if (result.valid) {
      this.sequencer.maybeEnterOutreach(id).catch((err) =>
        this.logger.warn(`Outreach entry failed for lead ${id}: ${(err as Error).message}`),
      );
      // Step 1's other required agents (enrich/company_intelligence) may
      // already have succeeded before the email was verified — re-evaluate
      // now rather than waiting for an agent event that may never come
      // again, or the lead's already-drafted Email 1 could sit at QUEUED
      // indefinitely.
      this.preparationPipeline.evaluate(id, 1).catch((err) =>
        this.logger.warn(`Preparation evaluation failed for lead ${id}: ${(err as Error).message}`),
      );
    }

    return { leadId: id, verifiedEmail: result.valid, reason: result.reason };
  }

  /**
   * Bulk counterpart to verifyEmail — the Ready column's "Verify emails"
   * button used to be a client-side loop awaiting one HTTP call at a time
   * (Part: reliability overhaul, 2026-08-31), which meant the whole batch's
   * wall-clock time was every lead's NeverBounce round trip added together.
   * Bounded concurrency here keeps that same rate-limit-friendly ceiling
   * (NeverBounce's single-check endpoint, not built for a parallel blast)
   * while actually running leads concurrently instead of one at a time.
   * Each lead still goes through verifyEmail unchanged, so the existing
   * per-lead `lead.updated` realtime event is what updates that card's
   * badge — this only adds a batch-level progress event on top.
   */
  async verifyEmails(orgId: string, leadIds: string[]): Promise<{ total: number; verified: number }> {
    const CONCURRENCY = 5;
    const total = leadIds.length;
    let done = 0;
    let verified = 0;
    let cursor = 0;

    const worker = async () => {
      while (cursor < leadIds.length) {
        const leadId = leadIds[cursor++];
        try {
          const result = await this.verifyEmail(orgId, leadId);
          if (result.verifiedEmail) verified++;
        } catch (err) {
          this.logger.warn(`Bulk email verification failed for lead ${leadId}: ${(err as Error).message}`);
        }
        done++;
        this.realtime.emitToOrg(orgId, "leads.verifyEmailsProgress", { done, total });
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));
    return { total, verified };
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

    this.realtime.emitToOrg(orgId, "lead.updated", { leadId: id });

    // If this enrichment run set verifiedEmail true (the lead_verification
    // agent's own finding, not just a human edit), outreach can start right
    // away instead of waiting for a separate "Verify emails" click. No-ops
    // harmlessly otherwise, or if the lead has already moved past Ready.
    await this.sequencer.maybeEnterOutreach(id);

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
    await this.agentDispatch.add({ kind: "enrich", leadId, orgId });
  }

  /**
   * Stage transitions are validated against the state machine (Part C6) and
   * side-effect into the sequencer for the stages that trigger automation
   * (e.g. entering READY_FOR_OUTREACH enqueues Email #1).
   */
  async advanceStage(orgId: string, id: string, toStage: PipelineStage) {
    const lead = await this.assertOwnership(orgId, id);
    const current = await this.prisma.pipelineState.findUnique({ where: { leadId: id } });
    // A Lead Room lead (human-added, not yet promoted — see
    // promoteToPipeline) has no PipelineState row at all. Without this
    // check findUniqueOrThrow's P2025 would surface as an opaque "record
    // not found" instead of telling the user what to actually do.
    if (!current) {
      throw new BadRequestException(
        "This lead hasn't been moved to the Pipeline yet — promote it from Lead Room first.",
      );
    }

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
    await this.notifyMilestoneStage(orgId, lead.id, lead.companyName, toStage);

    return updated;
  }

  /** Only the stages a salesperson would actually want pinged about —
   *  every other automated hop (WAITING_EMAIL_N, EMAIL_N_SENT) is routine
   *  progress a notification would just be noise for. */
  private static readonly MILESTONE_STAGES = new Set<PipelineStage>([
    PipelineStage.MEETING_BOOKED,
    PipelineStage.PROPOSAL_SENT,
    PipelineStage.WON,
    PipelineStage.LOST,
  ]);

  private async notifyMilestoneStage(orgId: string, leadId: string, companyName: string, toStage: PipelineStage) {
    if (!LeadsService.MILESTONE_STAGES.has(toStage)) return;
    await this.notifications.notify(orgId, {
      category: NotificationCategory.LEADS,
      type: "LEAD_STAGE_CHANGED",
      severity: "WARNING",
      title: "Lead Moved to New Stage",
      message: `${companyName} moved to ${toStage.replace(/_/g, " ").toLowerCase()}.`,
      leadId,
      actionUrl: `/leads/${leadId}`,
    });
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

  /**
   * Moves a lead back to any earlier stage the caller picks, not only the one
   * immediately before it — moveBack's one-step undo doesn't reach far enough
   * when a card was advanced several stages too far, or when correcting a
   * mistake made a while ago (e.g. un-marking Lost, or pulling a lead back
   * out of the email sequence entirely). isValidRewind is the only gate: it
   * ignores the forward state machine (ALLOWED_TRANSITIONS) on purpose,
   * since a human undoing a mistake isn't constrained by what the automation
   * does next.
   *
   * Same reasoning as moveBack for the rest: cancels any pending wait timer
   * so rewinding out of a WAITING_* stage can't leave a stale send scheduled
   * against a stage the lead has left, and deliberately does NOT call
   * sequencer.onStageEntered — this is a correction, not a forward action,
   * and re-firing it could send a duplicate of an email that already went
   * out.
   */
  async rewindTo(orgId: string, id: string, toStage: PipelineStage) {
    await this.assertOwnership(orgId, id);
    const current = await this.prisma.pipelineState.findUniqueOrThrow({ where: { leadId: id } });

    if (!isValidRewind(current.stage as PipelineStage, toStage)) {
      throw new BadRequestException(`Cannot move lead from ${current.stage} back to ${toStage}`);
    }

    await this.sequencer.cancelWaitTimer(id);

    const updated = await this.prisma.pipelineState.update({
      where: { leadId: id },
      data: { stage: toStage, previousStage: current.stage, enteredStageAt: new Date() },
    });

    await this.prisma.lead.update({ where: { id }, data: { lastActivityAt: new Date() } });

    this.sync.onStageChanged(id, toStage).catch((err) =>
      this.logger.warn(`ClickUp sync failed for lead ${id}: ${(err as Error).message}`),
    );

    return updated;
  }

  /** Retries an email that failed to send — e.g. it failed because no mailbox
   *  was configured yet, and one has since been added. Sends synchronously
   *  and returns the real outcome, not a blind "resent: true" — the whole
   *  point of dropping the queue was knowing immediately whether a retry
   *  actually worked. */
  async resendEmail(orgId: string, leadId: string, emailMessageId: string) {
    await this.assertOwnership(orgId, leadId);
    const message = await this.prisma.emailMessage.findFirst({ where: { id: emailMessageId, leadId } });
    if (!message) throw new NotFoundException("Email message not found");
    return this.sequencer.resendFailedMessage(emailMessageId);
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
      data: {
        subject: finalSubject,
        bodyHtml: finalBody,
        generatedBy,
        status: "QUEUED",
        trackEmailOpen: dto.trackEmailOpen ?? false,
      },
    });

    // A human approving a draft is one of the events that can complete
    // preparation (Part: Preparation Pipeline / Sending Queue, 2026-09-01)
    // — evaluate() re-reads every required agent's status and, since this
    // approval is what just made the row QUEUED, releases it into the
    // sending queue immediately if the rest of the manifest already
    // succeeded (the normal case: drafting itself is what produced the
    // PENDING_APPROVAL row in the first place).
    await this.preparationPipeline.evaluate(leadId, approved.sequenceStep);
    return this.prisma.emailMessage.findUniqueOrThrow({ where: { id: approved.id } });
  }

  /** Which pipeline stage each step of the 5-email sequence lands the lead
   *  in once its draft arrives (Part: 5-email sequence, 2026-08-12). */
  private static readonly STAGE_FOR_STEP: Record<number, PipelineStage> = {
    1: PipelineStage.EMAIL_1_SENT,
    2: PipelineStage.EMAIL_2_SENT,
    3: PipelineStage.EMAIL_3_SENT,
    4: PipelineStage.EMAIL_4_SENT,
    5: PipelineStage.EMAIL_5_SENT,
  };

  /** The stage a lead must be in for a (re)draft of a given step to make
   *  sense — the inverse of STAGE_FOR_STEP, plus READY_FOR_OUTREACH for
   *  step 1, which has no distinct "waiting" stage of its own. */
  private static readonly STEP_FOR_WAITING_STAGE: Partial<Record<PipelineStage, number>> = {
    [PipelineStage.READY_FOR_OUTREACH]: 1,
    [PipelineStage.WAITING_EMAIL_2]: 2,
    [PipelineStage.WAITING_EMAIL_3]: 3,
    [PipelineStage.WAITING_EMAIL_4]: 4,
    [PipelineStage.WAITING_EMAIL_5]: 5,
  };

  /**
   * Called by the ai-workers "email" agent (via the internal-token-guarded
   * endpoint) once one step of the 5-email sequence is drafted. Defaults to
   * auto-send (Part: autonomous system) — an org can opt back into a human
   * approving each one first via the Settings toggle
   * (Organization.settings.autoSendEnabled) — but `needsReview` overrides
   * that setting unconditionally: a draft the worker's own lint flagged
   * (an unresolved [BRACKET PLACEHOLDER], or a voice/structure rule still
   * broken after one retry) must reach a human before it can reach a
   * prospect, no matter what the org configured.
   */
  async receiveEmailDraft(
    leadId: string,
    dto: { sequenceStep: number; subject: string; bodyHtml: string; rationale: unknown; needsReview?: boolean },
  ) {
    const lead = await this.prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: lead.orgId } });
    const autoSendEnabled = (org.settings as Record<string, unknown>)?.autoSendEnabled !== false;
    const status = dto.needsReview ? "PENDING_APPROVAL" : autoSendEnabled ? "QUEUED" : "PENDING_APPROVAL";

    const message = await this.prisma.emailMessage.create({
      data: {
        leadId,
        sequenceStep: dto.sequenceStep,
        subject: dto.subject,
        bodyHtml: dto.bodyHtml,
        rationale: dto.rationale as Prisma.InputJsonValue,
        generatedBy: "CLAUDE",
        status,
      },
    });

    const stage = LeadsService.STAGE_FOR_STEP[dto.sequenceStep];
    if (stage) {
      await this.prisma.pipelineState.update({ where: { leadId }, data: { stage, enteredStageAt: new Date() } });
      await this.sync.onStageChanged(leadId, stage);
    }

    // No longer sends synchronously here (Part: Preparation Pipeline /
    // Sending Queue, 2026-09-01) — a QUEUED row now waits for
    // PreparationPipelineService.evaluate() to release it, which the
    // ai-workers caller triggers itself right after this by reporting
    // email_draft SUCCEEDED (see AgentExecutionService.succeed). Draft
    // creation and "is this lead fully prepared" are deliberately decoupled:
    // this message may still be blocked on enrich/company_intelligence
    // (step 1) even though drafting itself just finished.
    return message;
  }

  /**
   * Counterpart to receiveEmailDraft for when drafting itself produced
   * nothing (Claude CLI error/timeout, or a lint failure that survived the
   * retry — see gemini_agent/runner.py's run_email_draft). Before this
   * existed, that path just logged an error inside the ai-workers process
   * and returned — no EmailMessage row, no notification, nothing visible on
   * the lead. The lead was left sitting at whatever stage it was in,
   * indistinguishable from one that was simply waiting its turn (confirmed
   * 2026-08-31: 96 leads stuck at READY_FOR_OUTREACH for ~2 days after a
   * bulk-verify burst rate-limited the CLI, with no error surfaced anywhere).
   *
   * Recording a FAILED row here — rather than only notifying — is what makes
   * this self-healing: dispatchEmailDraft's existing idempotency check
   * already deletes-and-redispatches on a FAILED sequenceStep row, so the
   * "Generate pitch draft" button (requestEmailDraft) becomes a real retry
   * instead of a silent no-op ("already drafted, skip").
   */
  async receiveEmailDraftFailure(leadId: string, dto: ReportEmailDraftFailureDto) {
    const lead = await this.prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

    const existing = await this.prisma.emailMessage.findFirst({
      where: { leadId, sequenceStep: dto.sequenceStep },
    });
    if (existing) {
      // A message already exists for this step (e.g. a second drafting
      // attempt failed after a first one already succeeded) — don't
      // clobber real content with a failure row.
      return existing;
    }

    const message = await this.prisma.emailMessage.create({
      data: {
        leadId,
        sequenceStep: dto.sequenceStep,
        subject: "",
        bodyHtml: "",
        generatedBy: "CLAUDE",
        status: "FAILED",
        failureReason: dto.reason,
      },
    });

    this.realtime.emitToOrg(lead.orgId, "lead.updated", { leadId });
    await this.notifications.notify(lead.orgId, {
      category: NotificationCategory.AGENTS,
      type: "EMAIL_DRAFT_FAILED",
      severity: "ERROR",
      title: "Lead Automation Failed",
      message: `Email ${dto.sequenceStep} drafting failed for ${lead.companyName ?? leadId}: ${dto.reason}`,
      leadId,
      entityType: "emailMessage",
      entityId: message.id,
      actionUrl: `/leads/${leadId}`,
    });

    return message;
  }

  /**
   * Manually (re)triggers the AI draft for whichever step the lead is
   * currently waiting on. Exists for two cases: a lead stuck at a waiting
   * stage from before SequencerService.onStageEntered had a case for it, and
   * a run that genuinely failed — neither has any other way to recover
   * short of moving back and forward again, which also re-syncs external
   * state (ClickUp) unnecessarily.
   */
  async requestEmailDraft(orgId: string, leadId: string) {
    await this.assertOwnership(orgId, leadId);
    const state = await this.prisma.pipelineState.findUnique({ where: { leadId } });
    const step = state ? LeadsService.STEP_FOR_WAITING_STAGE[state.stage as PipelineStage] : undefined;
    if (!step) {
      throw new BadRequestException(
        `Lead is not at a stage where an email draft can be (re)requested (currently ${state?.stage ?? "unknown"})`,
      );
    }
    try {
      await this.sequencer.dispatchEmailDraft(leadId, step);
    } catch (err) {
      throw new ServiceUnavailableException(
        `Could not reach the AI workers: ${(err as Error).message}`,
      );
    }
    return { accepted: true, step };
  }

  /**
   * Manual re-draft, ownership-checked — the JWT-guarded escape hatch if an
   * automatic draft (see dispatchLinkedinDraft) came out wrong or never
   * arrived. The actual send stays human-driven end to end (ToS/ban risk,
   * never automatable); only the copy-drafting step is dispatched here.
   */
  async requestLinkedinDraft(orgId: string, leadId: string) {
    await this.assertOwnership(orgId, leadId);
    await this.dispatchLinkedinDraft(orgId, leadId);
    return { accepted: true };
  }

  /** Hands off to the LinkedInAgent for copy only. Called automatically
   *  alongside Email #1 (see SequencerService.sendEmail1) so a draft is
   *  already waiting by the time a person gets to LinkedIn outreach. */
  async dispatchLinkedinDraft(orgId: string, leadId: string) {
    await this.agentDispatch.add({ kind: "linkedin_draft", leadId, orgId });
  }

  /** Called by the LinkedInAgent (via the internal-token-guarded endpoint)
   *  once copy is drafted. There's no unique constraint tying one
   *  LinkedinActivity to one lead (sequencer.ts's sendEmail1 creates it
   *  lazily too), so this finds-or-creates rather than relying on upsert. */
  async receiveLinkedinDraft(leadId: string, messages: unknown) {
    const lead = await this.prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
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
    this.realtime.emitToOrg(lead.orgId, "lead.updated", { leadId });
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
   * Created with verifiedEmail still false: nothing has checked the website,
   * LinkedIn or email yet, and marking it verified because a human typed it
   * would put an unchecked address into the send queue the moment this lead
   * is promoted — a bounce damages the sending reputation of every mailbox
   * in the org. It reaches READY_FOR_OUTREACH like every lead once promoted,
   * but maybeEnterOutreach still won't draft Email 1 until something — the
   * "Verify emails" bulk action, a re-run enrichment, or a human checking
   * the box on the lead page — actually verifies it.
   */
  /** `sourceLayer` defaults to MANUAL (the "+Add lead" form never sends one) —
   *  other backend services pass an override, e.g. EmailHubService.addToLead
   *  passes EMAIL so a lead confirmed from an inbound message is
   *  distinguishable from one someone typed in by hand. */
  async createManual(
    orgId: string,
    dto: CreateManualLeadDto,
    sourceLayer: LeadSourceLayer = LeadSourceLayer.MANUAL,
    uploadedByUserId?: string,
  ): Promise<CreateLeadResult> {
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

    const lead = await this.insertManualLead(orgId, dto, websiteDomain, sourceLayer, uploadedByUserId);

    this.sync.onLeadCreated(lead.id).catch((err) =>
      this.logger.warn(`Sync dispatch failed for lead ${lead.id}: ${(err as Error).message}`),
    );
    this.socialMedia
      .runAutomationsForNewLead({ id: lead.id, orgId, companyName: dto.companyName, industry: dto.industry })
      .catch((err) => this.logger.warn(`Social automation dispatch failed for lead ${lead.id}: ${(err as Error).message}`));

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

  /** The insert core shared by createManual (one lead from the form) and
   *  importLeads (many from a CSV) — duplicate-checking, sync dispatch, and
   *  which enrichment queue to use differ between the two callers, so only
   *  the actual row-creation lives here. */
  private async insertManualLead(
    orgId: string,
    dto: Partial<CreateManualLeadDto> & { companyName: string },
    websiteDomain?: string,
    sourceLayer: LeadSourceLayer = LeadSourceLayer.MANUAL,
    uploadedByUserId?: string,
    importId?: string,
  ): Promise<{ id: string }> {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.lead.create({
        data: {
          orgId,
          companyName: dto.companyName,
          sourceLayer,
          // Part: Lead Upload Analytics, 2026-09-01 — every real caller
          // (the "+Add lead" form, EmailHubService.addToLead's "Add to
          // Lead" click) has a real user and passes it; undefined only for
          // a fully internal/system-triggered insert, if one is ever added.
          uploadedByUserId,
          importId,
          companyNameKey: normaliseCompanyName(dto.companyName),
          linkedinSlug: normaliseLinkedin(dto.linkedinUrl),
          website: dto.website,
          websiteDomain,
          linkedinUrl: dto.linkedinUrl,
          contactName: dto.contactName,
          contactLinkedinUrl: dto.contactLinkedinUrl,
          jobTitle: dto.jobTitle,
          email: dto.email,
          personalEmail: dto.personalEmail,
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

      // No PipelineState created here (unlike createVerified's agent path) —
      // a human-added lead (manual entry, CSV import, Email Hub "Add to
      // Lead") now sits in Lead Room until explicitly promoted via
      // promoteToPipeline below. maybeEnterOutreach elsewhere (fired when
      // enrichment results land) no-ops harmlessly on a lead with no
      // PipelineState, so enrichment/scoring still runs immediately and is
      // visible in Lead Room — only entering the actual pipeline waits for
      // promotion. AI-discovered leads (createVerified) are unaffected by
      // this change and land straight at READY_FOR_OUTREACH as usual.
      return created;
    });
  }

  /**
   * Parses just enough of an uploaded CSV to drive the column-mapping
   * screen (Part: lead import): the headers, a best-guess mapping for each
   * (see lead-import-mapping.ts), and a handful of preview rows so the user
   * can sanity-check the guess against real data before committing to it.
   */
  previewImport(csv: string): {
    headers: string[];
    suggestedMapping: Record<string, string | null>;
    previewRows: Record<string, string>[];
    totalRows: number;
  } {
    let headers: string[];
    let rows: Record<string, string>[];
    try {
      headers = parseCsvHeaders(csv);
      rows = parseCsvRows(csv);
    } catch (err) {
      throw new BadRequestException(`Could not parse this file as CSV: ${(err as Error).message}`);
    }
    if (headers.length === 0) {
      throw new BadRequestException("This file has no header row to map.");
    }

    return {
      headers,
      suggestedMapping: suggestMapping(headers),
      previewRows: rows.slice(0, 5),
      totalRows: rows.length,
    };
  }

  /**
   * Bulk-creates leads from a CSV against a confirmed column mapping (Part:
   * lead import). Each row gets the exact same duplicate check a single
   * manual add does — a company already in the system is skipped, never
   * merged or overwritten. Enrichment for every created lead is queued
   * through ImportEnrichmentQueue (concurrency 1, deliberately — see that
   * queue's own docblock) only after every row has been inserted.
   *
   * Batched, not per-row: this DB sits in a different region from the app
   * server (~200-400ms per round trip, see CacheService's docblock), and
   * the old version did up to 4 duplicate-check queries plus a 2-statement
   * insert transaction PER ROW — ~9000+ round trips for a 1500-row import.
   * Confirmed live: leads visibly trickled into the table one at a time
   * over tens of minutes. Every existing lead's dedupe identities (website
   * domain, email, LinkedIn slug, company-name key) are fetched once into
   * in-memory Sets; each accepted row's identities are added to those same
   * Sets immediately so a later row in the SAME CSV that duplicates an
   * earlier one is still caught, exactly like the old sequential version.
   * Inserts happen via chunked createMany instead of one row at a time.
   */
  async importLeads(
    orgId: string,
    csv: string,
    mapping: Record<string, string | null>,
    userId: string,
  ): Promise<{ created: number; duplicates: number; failed: { row: number; reason: string }[]; importId: string }> {
    let rows: Record<string, string>[];
    try {
      rows = parseCsvRows(csv);
    } catch (err) {
      throw new BadRequestException(`Could not parse this file as CSV: ${(err as Error).message}`);
    }

    // One durable record per upload (Part: Lead Upload Analytics,
    // 2026-09-01) — created up front (before any row is even validated) so
    // the import is visible immediately, then finalized with real counts
    // once the batch finishes below. `totalRecords` is the CSV's raw row
    // count; successful+duplicate+invalid always sums back to it.
    const importRecord = await this.prisma.leadImport.create({
      data: { orgId, uploadedByUserId: userId, sourceMethod: "CSV", totalRecords: rows.length },
    });

    const [existingDomains, existingEmails, existingLinkedinSlugs, existingCompanyKeys] = await Promise.all([
      this.prisma.lead.findMany({ where: { orgId, websiteDomain: { not: null } }, select: { websiteDomain: true } }),
      this.prisma.lead.findMany({ where: { orgId, email: { not: null } }, select: { email: true } }),
      this.prisma.lead.findMany({ where: { orgId, linkedinSlug: { not: null } }, select: { linkedinSlug: true } }),
      this.prisma.lead.findMany({ where: { orgId }, select: { companyNameKey: true } }),
    ]);
    const domainSet = new Set(existingDomains.map((l) => l.websiteDomain as string));
    const emailSet = new Set(existingEmails.map((l) => (l.email as string).toLowerCase()));
    const linkedinSet = new Set(existingLinkedinSlugs.map((l) => l.linkedinSlug as string));
    const companyKeySet = new Set(existingCompanyKeys.map((l) => l.companyNameKey));

    const failed: { row: number; reason: string }[] = [];
    let duplicateCount = 0;
    const accepted: {
      rowNumber: number;
      leadId: string;
      dto: Partial<CreateManualLeadDto> & { companyName: string };
      websiteDomain?: string;
    }[] = [];

    for (let i = 0; i < rows.length; i++) {
      // +2: 1-indexed for a human, plus the header row itself isn't a data row.
      const rowNumber = i + 2;
      const fields = mapRowToDto(rows[i], mapping);
      const companyName = typeof fields.companyName === "string" ? fields.companyName.trim() : "";

      if (companyName.length < 2) {
        failed.push({ row: rowNumber, reason: "missing or too-short company name" });
        continue;
      }
      const dto = { ...fields, companyName } as Partial<CreateManualLeadDto> & { companyName: string };
      const websiteDomain = extractDomain(dto.website);
      const email = dto.email?.toLowerCase();
      const linkedinSlug = normaliseLinkedin(dto.linkedinUrl);
      const companyKey = normaliseCompanyName(dto.companyName);

      const isDuplicate =
        (!!websiteDomain && domainSet.has(websiteDomain)) ||
        (!!email && emailSet.has(email)) ||
        (!!linkedinSlug && linkedinSet.has(linkedinSlug)) ||
        (!!companyKey && companyKeySet.has(companyKey));

      if (isDuplicate) {
        duplicateCount++;
        continue;
      }

      if (websiteDomain) domainSet.add(websiteDomain);
      if (email) emailSet.add(email);
      if (linkedinSlug) linkedinSet.add(linkedinSlug);
      if (companyKey) companyKeySet.add(companyKey);

      accepted.push({ rowNumber, leadId: randomUUID(), dto, websiteDomain });
    }

    const created: typeof accepted = [];
    const CHUNK_SIZE = 200;
    for (let i = 0; i < accepted.length; i += CHUNK_SIZE) {
      const chunk = accepted.slice(i, i + CHUNK_SIZE);
      try {
        await this.prisma.lead.createMany({
          data: chunk.map(({ leadId, dto, websiteDomain }) => ({
            id: leadId,
            orgId,
            companyName: dto.companyName,
            sourceLayer: LeadSourceLayer.MANUAL,
            uploadedByUserId: userId,
            importId: importRecord.id,
            companyNameKey: normaliseCompanyName(dto.companyName),
            linkedinSlug: normaliseLinkedin(dto.linkedinUrl),
            website: dto.website,
            websiteDomain,
            linkedinUrl: dto.linkedinUrl,
            contactName: dto.contactName,
            contactLinkedinUrl: dto.contactLinkedinUrl,
            jobTitle: dto.jobTitle,
            email: dto.email,
            personalEmail: dto.personalEmail,
            phone: dto.phone,
            industry: dto.industry,
            country: dto.country,
            city: dto.city,
            employeeCount: dto.employeeCount,
            businessDescription: dto.businessDescription,
            campaignId: dto.campaignId,
            researchEvidence: dto.notes ? `[MANUAL ENTRY] ${dto.notes}` : "[MANUAL ENTRY]",
          })),
        });
        await this.prisma.leadScore.createMany({
          data: chunk.map(({ leadId }) => ({
            leadId,
            leadScore: 0,
            confidenceScore: 0,
            aiOpportunityScore: 0,
            automationScore: 0,
            crmReadinessScore: 0,
            websiteQualityScore: 0,
            fitReason: "Added manually — not yet researched or scored.",
          })),
        });
        created.push(...chunk);
      } catch (err) {
        // createMany doesn't report which row in the chunk failed, so the
        // whole chunk is reported as failed rather than silently losing
        // rows or guessing which one was the problem.
        for (const row of chunk) failed.push({ row: row.rowNumber, reason: (err as Error).message });
      }
    }

    for (const { leadId, dto } of created) {
      this.sync.onLeadCreated(leadId).catch((err) =>
        this.logger.warn(`Sync dispatch failed for imported lead ${leadId}: ${(err as Error).message}`),
      );
      this.socialMedia
        .runAutomationsForNewLead({ id: leadId, orgId, companyName: dto.companyName, industry: dto.industry })
        .catch((err) => this.logger.warn(`Social automation dispatch failed for imported lead ${leadId}: ${(err as Error).message}`));
    }

    for (const { leadId } of created) {
      await this.importEnrichment.add({ leadId, orgId }).catch((err) =>
        this.logger.warn(`Import-enrichment dispatch failed for lead ${leadId}: ${(err as Error).message}`),
      );
    }

    await this.prisma.leadImport.update({
      where: { id: importRecord.id },
      data: {
        successfulRecords: created.length,
        duplicateRecords: duplicateCount,
        invalidRecords: failed.length,
      },
    });
    this.realtime.emitToOrg(orgId, "lead.import.completed", {
      importId: importRecord.id,
      total: rows.length,
      successful: created.length,
      duplicates: duplicateCount,
      invalid: failed.length,
    });

    return { created: created.length, duplicates: duplicateCount, failed, importId: importRecord.id };
  }

  /** Newest-first history of every CSV upload (Part: Lead Upload Analytics,
   *  2026-09-01) — a single manual "+Add lead" never appears here, only
   *  batches created by importLeads. */
  async listImports(orgId: string, page: number, pageSize: number) {
    const [items, total] = await Promise.all([
      this.prisma.leadImport.findMany({
        where: { orgId },
        include: { uploadedByUser: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.leadImport.count({ where: { orgId } }),
    ]);
    return { items, total, page, pageSize };
  }

  async getImport(orgId: string, importId: string) {
    const record = await this.prisma.leadImport.findFirst({
      where: { id: importId, orgId },
      include: { uploadedByUser: { select: { id: true, name: true } } },
    });
    if (!record) throw new NotFoundException("Import not found");
    const leadCount = await this.prisma.lead.count({ where: { importId } });
    return { ...record, leadCount };
  }

  /**
   * Looks up a lead by the same identities findExistingDuplicate checks
   * (email, LinkedIn URL, normalised company name), returning the actual
   * row instead of just a reason string — for callers that need to link to
   * an existing lead rather than merely reject a duplicate insert. Built for
   * the Email Hub's "Add to Lead" (Part: Lead Integration): a reply from a
   * known contact must link to their existing lead, never create a second
   * one for the same person.
   */
  async findLeadByContact(
    orgId: string,
    contact: { email?: string; companyName?: string; linkedinUrl?: string },
  ) {
    const checks: Prisma.LeadWhereInput[] = [];
    if (contact.email) checks.push({ orgId, email: { equals: contact.email, mode: "insensitive" } });
    const linkedin = normaliseLinkedin(contact.linkedinUrl);
    if (linkedin) checks.push({ orgId, linkedinSlug: linkedin });
    const name = normaliseCompanyName(contact.companyName);
    if (name) checks.push({ orgId, companyNameKey: name });

    for (const where of checks) {
      const lead = await this.prisma.lead.findFirst({ where });
      if (lead) return lead;
    }
    return null;
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
