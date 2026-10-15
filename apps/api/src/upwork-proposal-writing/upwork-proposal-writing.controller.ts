import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { ModuleAccessGuard } from "../common/guards/module-access.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims, Role } from "@leadgen/types";
import { ProposalWritingService } from "./services/proposal-writing.service";
import { ProposalWritingSettingsService } from "./services/proposal-writing-settings.service";
import { FreelancerProfilesService } from "./services/freelancer-profiles.service";
import { GenerateCoverLetterDto } from "./dto/generate-cover-letter.dto";
import { UpdateProposalWritingSettingsDto } from "./dto/update-proposal-writing-settings.dto";
import { CreateFreelancerProfileDto, UpdateFreelancerProfileDto } from "./dto/freelancer-profile.dto";

/**
 * Standard JwtAuthGuard + RolesGuard + ModuleAccessGuard stack, same as
 * every other module (Part: Upwork Proposal Writing).
 *
 * Settings (instructions/word limits/excluded countries) writes are
 * ADMIN-only — shared SOP governance, same reasoning as UpworkApiController's
 * connect/disconnect.
 *
 * Freelancer-profile CRUD is deliberately NOT role-restricted beyond the
 * module flag itself (Part: same day, real-world correction — granting a
 * BUSINESS_DEVELOPER the module flag and then having "Add profile" 403 for
 * them because it was ADMIN-only wasn't the intent). Profiles are an
 * operational roster anyone with access to this module maintains, not
 * org-wide policy like the settings above.
 */
@Controller("upwork-proposal-writing")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule("UPWORK_PROPOSAL_WRITING")
export class UpworkProposalWritingController {
  constructor(
    private readonly proposalWriting: ProposalWritingService,
    private readonly settings: ProposalWritingSettingsService,
    private readonly freelancerProfiles: FreelancerProfilesService,
  ) {}

  @Post("generate")
  generate(@CurrentUser() user: JwtClaims, @Body() dto: GenerateCoverLetterDto) {
    const { jobUrl, extractedJob, ...manual } = dto;
    return this.proposalWriting.generate(user.orgId, user.sub, jobUrl, { extractedJob, manual });
  }

  @Get("drafts")
  listDrafts(@CurrentUser() user: JwtClaims) {
    return this.proposalWriting.listDrafts(user.orgId);
  }

  @Get("settings")
  getSettings(@CurrentUser() user: JwtClaims) {
    return this.settings.get(user.orgId);
  }

  @Put("settings")
  @Roles(Role.ADMIN)
  updateSettings(@CurrentUser() user: JwtClaims, @Body() dto: UpdateProposalWritingSettingsDto) {
    return this.settings.update(user.orgId, user.sub, dto);
  }

  @Get("freelancer-profiles")
  listFreelancerProfiles(@CurrentUser() user: JwtClaims) {
    return this.freelancerProfiles.list(user.orgId);
  }

  @Post("freelancer-profiles")
  createFreelancerProfile(@CurrentUser() user: JwtClaims, @Body() dto: CreateFreelancerProfileDto) {
    return this.freelancerProfiles.create(user.orgId, dto);
  }

  @Put("freelancer-profiles/:id")
  updateFreelancerProfile(
    @CurrentUser() user: JwtClaims,
    @Param("id") id: string,
    @Body() dto: UpdateFreelancerProfileDto,
  ) {
    return this.freelancerProfiles.update(user.orgId, id, dto);
  }

  @Delete("freelancer-profiles/:id")
  deleteFreelancerProfile(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.freelancerProfiles.delete(user.orgId, id);
  }
}
