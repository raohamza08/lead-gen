import { Body, Controller, Delete, Get, Param, ParseEnumPipe, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";
import { LeadsService } from "./leads.service";
import { CreateLeadDto } from "./dto/create-lead.dto";
import { CreateManualLeadDto } from "./dto/create-manual-lead.dto";
import { PreviewImportDto } from "./dto/preview-import.dto";
import { ImportLeadsDto } from "./dto/import-leads.dto";
import { ReviewNoteDto } from "./dto/review-note.dto";
import { UpdateLeadContactDto } from "./dto/update-lead-contact.dto";
import { AdvanceStageDto } from "./dto/advance-stage.dto";
import { ApproveEmailDto } from "./dto/approve-email.dto";
import { QueryLeadsDto } from "./dto/query-leads.dto";
import { CreateEmailDraftDto } from "./dto/create-email-draft.dto";
import { ApplyEnrichmentDto } from "./dto/apply-enrichment.dto";
import { PromoteToPipelineDto } from "./dto/promote-to-pipeline.dto";
import { BulkDeleteLeadsDto } from "./dto/bulk-delete-leads.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { InternalAuthGuard } from "../common/guards/internal-auth.guard";
import { ModuleAccessGuard } from "../common/guards/module-access.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims, PipelineStage, Role } from "@leadgen/types";

@Controller("leads")
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  /** Called by the Claude lead-gen agent, not the dashboard — hence InternalAuthGuard. */
  @Post()
  @UseGuards(InternalAuthGuard)
  create(@Body("orgId") orgId: string, @Body() dto: CreateLeadDto) {
    return this.leadsService.createVerified(orgId, dto);
  }

  /**
   * Manual lead entry from the dashboard.
   *
   * Separate from the internal POST above rather than relaxing that guard: the
   * agent route trusts its caller with orgId and pre-computed scores, and a
   * user-facing endpoint must take orgId from the JWT instead. It also runs the
   * same duplicate checks, so hand-entering a company the agents already found
   * is rejected rather than creating a second record someone contacts twice.
   */
  @Post("manual")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
  @RequiresModule("LEAD_GENERATION")
  @Roles(Role.ADMIN, Role.MANAGER, Role.SALES_REP, Role.LEAD_REVIEWER)
  createManual(@CurrentUser() user: JwtClaims, @Body() dto: CreateManualLeadDto) {
    return this.leadsService.createManual(user.orgId, dto);
  }

  /** Lead Room's "Move to Pipeline" action — see LeadsService.promoteToPipeline. */
  @Post("promote-to-pipeline")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
  @RequiresModule("LEAD_GENERATION")
  @Roles(Role.ADMIN, Role.MANAGER, Role.SALES_REP, Role.LEAD_REVIEWER)
  promoteToPipeline(@CurrentUser() user: JwtClaims, @Body() dto: PromoteToPipelineDto) {
    return this.leadsService.promoteToPipeline(user.orgId, dto);
  }

  /** Headers, a suggested column mapping, and a preview of the first few
   *  rows for the CSV-import mapping screen (Part: lead import). Read-only —
   *  doesn't touch the database, just parses. */
  @Post("import/preview")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
  @RequiresModule("LEAD_GENERATION")
  @Roles(Role.ADMIN, Role.MANAGER, Role.SALES_REP, Role.LEAD_REVIEWER)
  previewImport(@Body() dto: PreviewImportDto) {
    return this.leadsService.previewImport(dto.csv);
  }

  /** Bulk-creates leads from a CSV against a confirmed column mapping (Part:
   *  lead import). Same duplicate checks and role gate as a single manual add. */
  @Post("import")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
  @RequiresModule("LEAD_GENERATION")
  @Roles(Role.ADMIN, Role.MANAGER, Role.SALES_REP, Role.LEAD_REVIEWER)
  importLeads(@CurrentUser() user: JwtClaims, @Body() dto: ImportLeadsDto) {
    return this.leadsService.importLeads(user.orgId, dto.csv, dto.mapping);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
  @RequiresModule("LEAD_GENERATION")
  findAll(@CurrentUser() user: JwtClaims, @Query() query: QueryLeadsDto) {
    return this.leadsService.findAll(user.orgId, query);
  }

  // Must come before ":id" — otherwise Nest matches "export" as the :id param
  // and this route is never reached.
  @Get("export")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
  @RequiresModule("LEAD_GENERATION")
  async exportCsv(@CurrentUser() user: JwtClaims, @Res() res: Response) {
    const csv = await this.leadsService.exportCsv(user.orgId);
    res
      .set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      })
      .send(csv);
  }

  // Must come before ":id" for the same reason "export" does above.
  @Get("source-breakdown")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
  @RequiresModule("LEAD_GENERATION")
  sourceBreakdown(@CurrentUser() user: JwtClaims) {
    return this.leadsService.getSourceBreakdown(user.orgId);
  }

  @Get(":id")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
  @RequiresModule("LEAD_GENERATION")
  findOne(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.leadsService.findOne(user.orgId, id);
  }

  /**
   * Called by the Gemini agent to fetch lead context before drafting Email #3
   * (Part D2). Internal-token-guarded rather than user-JWT-guarded since the
   * AI worker has no user session — orgId is passed explicitly instead of
   * being read off a JWT claim.
   */
  @Get(":id/internal")
  @UseGuards(InternalAuthGuard)
  findOneInternal(@Param("id") id: string, @Query("orgId") orgId: string) {
    return this.leadsService.findOne(orgId, id);
  }

  @Patch(":id/review")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
  @RequiresModule("LEAD_GENERATION")
  @Roles(Role.ADMIN, Role.MANAGER, Role.LEAD_REVIEWER)
  updateReview(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: ReviewNoteDto) {
    return this.leadsService.updateReviewNote(user.orgId, id, user.sub, dto);
  }

  @Patch(":id/contact")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
  @RequiresModule("LEAD_GENERATION")
  @Roles(Role.ADMIN, Role.MANAGER, Role.LEAD_REVIEWER, Role.SALES_REP)
  updateContact(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: UpdateLeadContactDto) {
    return this.leadsService.updateContact(user.orgId, id, dto);
  }

  /**
   * Triggers the research/verification/scoring pipeline for a lead that
   * already exists — runs automatically once for a manually-entered lead;
   * exposed here to re-run it (e.g. a lead added before this existed, or a
   * run that failed).
   */
  @Post(":id/enrich")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
  @RequiresModule("LEAD_GENERATION")
  @Roles(Role.ADMIN, Role.MANAGER, Role.LEAD_REVIEWER, Role.SALES_REP)
  enrich(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.leadsService.requestEnrichment(user.orgId, id);
  }

  /** Called by the AI workers once the manual-lead enrichment pipeline
   *  finishes. See LeadsService.applyEnrichment. */
  @Patch(":id/enrichment")
  @UseGuards(InternalAuthGuard)
  receiveEnrichment(
    @Param("id") id: string,
    @Body("orgId") orgId: string,
    @Body() dto: ApplyEnrichmentDto,
  ) {
    return this.leadsService.applyEnrichment(orgId, id, dto);
  }

  @Post(":id/advance-stage")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
  @RequiresModule("LEAD_GENERATION")
  @Roles(Role.ADMIN, Role.MANAGER, Role.LEAD_REVIEWER, Role.SALES_REP)
  advanceStage(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: AdvanceStageDto) {
    return this.leadsService.advanceStage(user.orgId, id, dto.stage);
  }

  /** Undo one step — see LeadsService.moveBack for why this doesn't re-run automation. */
  @Post(":id/move-back")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
  @RequiresModule("LEAD_GENERATION")
  @Roles(Role.ADMIN, Role.MANAGER, Role.LEAD_REVIEWER, Role.SALES_REP)
  moveBack(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.leadsService.moveBack(user.orgId, id);
  }

  /** Back to any earlier stage the caller picks — see LeadsService.rewindTo. */
  @Post(":id/rewind")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
  @RequiresModule("LEAD_GENERATION")
  @Roles(Role.ADMIN, Role.MANAGER, Role.LEAD_REVIEWER, Role.SALES_REP)
  rewind(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: AdvanceStageDto) {
    return this.leadsService.rewindTo(user.orgId, id, dto.stage);
  }

  /** Re-checks this lead's email and starts outreach immediately if it now
   *  verifies. See LeadsService.verifyEmail. */
  @Post(":id/verify-email")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
  @RequiresModule("LEAD_GENERATION")
  @Roles(Role.ADMIN, Role.MANAGER, Role.LEAD_REVIEWER, Role.SALES_REP)
  verifyEmail(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.leadsService.verifyEmail(user.orgId, id);
  }

  @Post(":id/emails/:emailMessageId/resend")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
  @RequiresModule("LEAD_GENERATION")
  @Roles(Role.ADMIN, Role.MANAGER, Role.SALES_REP)
  resendEmail(
    @CurrentUser() user: JwtClaims,
    @Param("id") id: string,
    @Param("emailMessageId") emailMessageId: string,
  ) {
    return this.leadsService.resendEmail(user.orgId, id, emailMessageId);
  }

  @Post(":id/approve-email")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
  @RequiresModule("LEAD_GENERATION")
  @Roles(Role.ADMIN, Role.MANAGER, Role.SALES_REP)
  approveEmail(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: ApproveEmailDto) {
    return this.leadsService.approveEmail(user.orgId, id, dto);
  }

  /** Called by the ai-workers "email" agent once one step of the 5-email
   *  sequence is drafted (Part: 5-email sequence, 2026-08-12). */
  @Post(":id/draft-email")
  @UseGuards(InternalAuthGuard)
  receiveDraft(@Param("id") id: string, @Body() dto: CreateEmailDraftDto) {
    return this.leadsService.receiveEmailDraft(id, dto);
  }

  /** (Re)triggers the AI draft for whichever step the lead is currently
   *  waiting on — recovers a lead stuck at a waiting stage (see
   *  SequencerService.onStageEntered) or retries a draft that failed. */
  @Post(":id/pitch-draft/generate")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
  @RequiresModule("LEAD_GENERATION")
  @Roles(Role.ADMIN, Role.MANAGER, Role.LEAD_REVIEWER, Role.SALES_REP)
  generatePitchDraft(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.leadsService.requestEmailDraft(user.orgId, id);
  }

  /** Triggers the LinkedInAgent for this lead — manual, not automatic on
   *  stage entry, since LinkedIn outreach itself stays human-sent. */
  @Post(":id/linkedin-draft/generate")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
  @RequiresModule("LEAD_GENERATION")
  @Roles(Role.ADMIN, Role.MANAGER, Role.LEAD_REVIEWER, Role.SALES_REP)
  generateLinkedinDraft(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.leadsService.requestLinkedinDraft(user.orgId, id);
  }

  /** Called by the LinkedInAgent once copy is drafted. */
  @Patch(":id/linkedin-draft")
  @UseGuards(InternalAuthGuard)
  receiveLinkedinDraft(@Param("id") id: string, @Body("messages") messages: unknown) {
    return this.leadsService.receiveLinkedinDraft(id, messages);
  }

  // ADMIN only, same reasoning as remove() below — bulk version for the
  // Pipeline board's "clear this stage" action. Declared ahead of the
  // single-lead :id route for readability; the two never actually collide
  // since "by-stage/:stage" is a two-segment path and ":id" only matches one.
  @Delete("by-stage/:stage")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
  @RequiresModule("LEAD_GENERATION")
  @Roles(Role.ADMIN)
  removeByStage(@CurrentUser() user: JwtClaims, @Param("stage", new ParseEnumPipe(PipelineStage)) stage: PipelineStage) {
    return this.leadsService.removeByStage(user.orgId, stage);
  }

  // ADMIN only, same reasoning as remove() below — Lead Room's "delete
  // selected" action for a user-picked set of ids. POST (not DELETE) since
  // the id list travels as a body, matching promote-to-pipeline's own
  // bulk-action convention rather than a DELETE-with-body, which some
  // clients/proxies handle inconsistently.
  @Post("bulk-delete")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
  @RequiresModule("LEAD_GENERATION")
  @Roles(Role.ADMIN)
  removeByIds(@CurrentUser() user: JwtClaims, @Body() dto: BulkDeleteLeadsDto) {
    return this.leadsService.removeByIds(user.orgId, dto.leadIds);
  }

  // ADMIN only: unlike other deletes in this app (niche filter, email
  // account), there is no "detach and keep" option — this removes the lead's
  // full history, including any real emails already sent to the prospect.
  @Delete(":id")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
  @RequiresModule("LEAD_GENERATION")
  @Roles(Role.ADMIN)
  remove(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.leadsService.remove(user.orgId, id);
  }
}
