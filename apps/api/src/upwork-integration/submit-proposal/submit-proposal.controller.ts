import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { ModuleAccessGuard } from "../../common/guards/module-access.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequiresModule } from "../../common/decorators/requires-module.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtClaims, Role } from "@leadgen/types";
import { UpworkSubmitProposalService } from "./submit-proposal.service";
import { SubmitProposalDto } from "./submit-proposal.dto";

/** Submit Proposals to Jobs domain (spec Module Q) — LIVE, real mutation.
 *  ADMIN-only on top of the module flag -- this spends real Connects and
 *  submits a real bid representing the agency externally, same
 *  privilege tier as connect/disconnect/organization-id. Same guard
 *  stack and `upwork-api` route prefix as every other Upwork
 *  sub-controller. */
@Controller("upwork-api")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule("UPWORK_AGENCY_SUBMIT_PROPOSAL")
export class UpworkSubmitProposalController {
  constructor(private readonly submitProposal: UpworkSubmitProposalService) {}

  @Post("submit-proposal")
  @Roles(Role.ADMIN)
  submit(@CurrentUser() user: JwtClaims, @Body() dto: SubmitProposalDto) {
    return this.submitProposal.submit(user.orgId, user.sub, dto);
  }
}
