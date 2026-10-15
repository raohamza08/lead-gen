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
 * every other module (Part: Upwork Proposal Writing). Settings/freelancer-
 * profile reads are available to anyone with the module flag (so they can
 * see what the generator is working from); writes are ADMIN-only, same
 * reasoning as UpworkApiController's connect/disconnect — these edit a
 * shared, org-wide configuration, not a per-user preference.
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
    return this.proposalWriting.generate(user.orgId, user.sub, dto.jobUrl);
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
  @Roles(Role.ADMIN)
  createFreelancerProfile(@CurrentUser() user: JwtClaims, @Body() dto: CreateFreelancerProfileDto) {
    return this.freelancerProfiles.create(user.orgId, dto);
  }

  @Put("freelancer-profiles/:id")
  @Roles(Role.ADMIN)
  updateFreelancerProfile(
    @CurrentUser() user: JwtClaims,
    @Param("id") id: string,
    @Body() dto: UpdateFreelancerProfileDto,
  ) {
    return this.freelancerProfiles.update(user.orgId, id, dto);
  }

  @Delete("freelancer-profiles/:id")
  @Roles(Role.ADMIN)
  deleteFreelancerProfile(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.freelancerProfiles.delete(user.orgId, id);
  }
}
