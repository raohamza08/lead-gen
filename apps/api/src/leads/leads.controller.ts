import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { LeadsService } from "./leads.service";
import { CreateLeadDto } from "./dto/create-lead.dto";
import { CreateManualLeadDto } from "./dto/create-manual-lead.dto";
import { ReviewNoteDto } from "./dto/review-note.dto";
import { AdvanceStageDto } from "./dto/advance-stage.dto";
import { ApproveEmailDto } from "./dto/approve-email.dto";
import { QueryLeadsDto } from "./dto/query-leads.dto";
import { CreateEmailDraftDto } from "./dto/create-email-draft.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { InternalAuthGuard } from "../common/guards/internal-auth.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims, Role } from "@leadgen/types";

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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER, Role.SALES_REP, Role.LEAD_REVIEWER)
  createManual(@CurrentUser() user: JwtClaims, @Body() dto: CreateManualLeadDto) {
    return this.leadsService.createManual(user.orgId, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  findAll(@CurrentUser() user: JwtClaims, @Query() query: QueryLeadsDto) {
    return this.leadsService.findAll(user.orgId, query);
  }

  @Get(":id")
  @UseGuards(JwtAuthGuard, RolesGuard)
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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER, Role.LEAD_REVIEWER)
  updateReview(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: ReviewNoteDto) {
    return this.leadsService.updateReviewNote(user.orgId, id, user.sub, dto);
  }

  @Post(":id/advance-stage")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER, Role.LEAD_REVIEWER, Role.SALES_REP)
  advanceStage(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: AdvanceStageDto) {
    return this.leadsService.advanceStage(user.orgId, id, dto.stage);
  }

  @Post(":id/approve-email")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.MANAGER, Role.SALES_REP)
  approveEmail(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: ApproveEmailDto) {
    return this.leadsService.approveEmail(user.orgId, id, dto);
  }

  /** Called by the Gemini agent once Email #3 is drafted (Part D2). */
  @Post(":id/draft-email")
  @UseGuards(InternalAuthGuard)
  receiveDraft(@Param("id") id: string, @Body() dto: CreateEmailDraftDto) {
    return this.leadsService.receiveEmail3Draft(id, dto);
  }
}
