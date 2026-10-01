import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { UpworkProposalAccessGuard } from "./upwork-proposal-access.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims, Role } from "@leadgen/types";
import { UpworkService } from "./upwork.service";
import { CreateUpworkProposalDto } from "./dto/create-upwork-proposal.dto";
import { UpdateUpworkProposalDto } from "./dto/update-upwork-proposal.dto";
import { QueryUpworkProposalsDto } from "./dto/query-upwork-proposals.dto";
import { UpdateUpworkPicklistsDto } from "./dto/update-upwork-picklists.dto";
import { SetNotifyRecipientsDto } from "./dto/set-notify-recipients.dto";
import { AuditLogService } from "../audit-log/audit-log.service";

@Controller("upwork/proposals")
@UseGuards(JwtAuthGuard, RolesGuard, UpworkProposalAccessGuard)
export class UpworkController {
  constructor(
    private readonly upwork: UpworkService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get("stats")
  getStats(@CurrentUser() user: JwtClaims) {
    return this.upwork.getStats(user.orgId);
  }

  /** Every authenticated user with Upwork access reads these — they're what
   *  populates the dropdowns on the submission form. */
  @Get("picklists")
  getPicklists(@CurrentUser() user: JwtClaims) {
    return this.upwork.getPicklists(user.orgId);
  }

  /** Only an admin can edit the option lists themselves. */
  @Patch("picklists")
  @Roles(Role.ADMIN)
  updatePicklists(@CurrentUser() user: JwtClaims, @Body() dto: UpdateUpworkPicklistsDto) {
    return this.upwork.updatePicklists(user.orgId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: JwtClaims, @Query() query: QueryUpworkProposalsDto) {
    return this.upwork.findAll(user.orgId, query);
  }

  @Get(":id")
  findOne(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.upwork.findOne(user.orgId, id);
  }

  @Post()
  async create(@CurrentUser() user: JwtClaims, @Body() dto: CreateUpworkProposalDto) {
    const proposal = await this.upwork.create(user.orgId, dto);
    this.auditLog.write({ orgId: user.orgId, actorId: user.sub, action: "UPWORK_PROPOSAL_CREATED", entityType: "upworkProposal", entityId: proposal.id, metadata: { type: proposal.type } });
    return proposal;
  }

  @Patch(":id")
  update(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: UpdateUpworkProposalDto) {
    return this.upwork.update(user.orgId, id, dto);
  }

  /** Admin-only, same reasoning as updatePicklists — choosing who gets
   *  pinged about a client relationship is an org-level call, not something
   *  any submitter should be able to redirect to themselves or a teammate. */
  @Patch(":id/notify-recipients")
  @Roles(Role.ADMIN)
  setNotifyRecipients(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: SetNotifyRecipientsDto) {
    return this.upwork.setNotifyRecipients(user.orgId, id, dto);
  }

  /** Same reasoning as leads' bulk-delete: mistakes should be fixable, but
   *  only by someone with real authority over the data, not any submitter. */
  @Delete(":id")
  @Roles(Role.ADMIN, Role.MANAGER)
  remove(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.upwork.remove(user.orgId, id);
  }
}
