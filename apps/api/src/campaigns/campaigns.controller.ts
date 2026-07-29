import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Min } from "class-validator";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims, PipelineStage, Role } from "@leadgen/types";

export class UpsertCampaignDto {
  @IsString() name!: string;
  @IsString() niche!: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() offer?: string;
  @IsOptional() @IsString() caseStudy?: string;
  @IsOptional() @IsString() goal?: string;
  @IsOptional() @IsInt() @Min(1) targetLeads?: number;
  // Prisma.InputJsonValue[] rather than unknown[]: Prisma will not accept an
  // unknown-element array as a Json column value.
  @IsOptional() @IsArray() emailSequence?: Prisma.InputJsonValue[];
  @IsOptional() @IsArray() linkedinSequence?: Prisma.InputJsonValue[];
  @IsOptional() @IsString() filterId?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

/** Stages that mean the deal closed successfully. */
const WON_STAGES = [PipelineStage.WON, PipelineStage.CLIENT_ONBOARDING];
/** Stages that mean a meeting happened or the deal went further. */
const MEETING_OR_BEYOND = [
  PipelineStage.MEETING_BOOKED,
  PipelineStage.PROPOSAL_SENT,
  PipelineStage.NEGOTIATION,
  ...WON_STAGES,
];

@Controller("campaigns")
@UseGuards(JwtAuthGuard, RolesGuard)
export class CampaignsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  findAll(@CurrentUser() user: JwtClaims) {
    return this.prisma.campaign.findMany({
      where: { orgId: user.orgId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { leads: true } } },
    });
  }

  /**
   * Per-campaign outcomes — the whole reason campaigns exist.
   *
   * Counts come from pipeline stage rather than email events, so a lead that
   * replied via LinkedIn or a forwarded introduction still counts. Attributing
   * outcomes only to tracked email opens would systematically undercount the
   * channels that actually close deals.
   */
  @Get("performance")
  async performance(@CurrentUser() user: JwtClaims) {
    const campaigns = await this.prisma.campaign.findMany({
      where: { orgId: user.orgId },
      orderBy: { createdAt: "desc" },
    });

    return Promise.all(
      campaigns.map(async (campaign) => {
        const where = { orgId: user.orgId, campaignId: campaign.id };
        const [leads, replied, meetings, won, valueAgg] = await Promise.all([
          this.prisma.lead.count({ where }),
          this.prisma.pipelineState.count({
            where: { lead: where, stage: { in: [PipelineStage.REPLIED, ...MEETING_OR_BEYOND] } },
          }),
          this.prisma.pipelineState.count({ where: { lead: where, stage: { in: MEETING_OR_BEYOND } } }),
          this.prisma.pipelineState.count({ where: { lead: where, stage: { in: WON_STAGES } } }),
          this.prisma.leadScore.aggregate({ where: { lead: where }, _sum: { expectedValue: true } }),
        ]);

        const rate = (n: number) => (leads ? Math.round((n / leads) * 1000) / 10 : 0);

        return {
          id: campaign.id,
          name: campaign.name,
          niche: campaign.niche,
          country: campaign.country,
          offer: campaign.offer,
          active: campaign.active,
          targetLeads: campaign.targetLeads,
          leads,
          replied,
          meetings,
          won,
          pipelineValue: Math.round(Number(valueAgg._sum.expectedValue ?? 0)),
          replyRate: rate(replied),
          meetingRate: rate(meetings),
          winRate: rate(won),
        };
      }),
    );
  }

  @Get(":id")
  findOne(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.prisma.campaign.findFirst({
      where: { id, orgId: user.orgId },
      include: { _count: { select: { leads: true } } },
    });
  }

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  create(@CurrentUser() user: JwtClaims, @Body() dto: UpsertCampaignDto) {
    return this.prisma.campaign.create({
      data: { ...dto, orgId: user.orgId, emailSequence: dto.emailSequence ?? [], linkedinSequence: dto.linkedinSequence ?? [] },
    });
  }

  @Patch(":id")
  @Roles(Role.ADMIN, Role.MANAGER)
  async update(
    @CurrentUser() user: JwtClaims,
    @Param("id") id: string,
    @Body() dto: Partial<UpsertCampaignDto>,
  ) {
    // Scoped update, not a bare where:{id} — otherwise a valid token for one org
    // could edit another org's campaign by guessing an id.
    //
    // Fields are copied across explicitly rather than spread: `updateMany`
    // cannot set a relation scalar like filterId, and spreading the DTO would
    // also let any future field on it become writable without review.
    await this.prisma.campaign.updateMany({
      where: { id, orgId: user.orgId },
      data: {
        name: dto.name,
        niche: dto.niche,
        country: dto.country,
        offer: dto.offer,
        caseStudy: dto.caseStudy,
        goal: dto.goal,
        targetLeads: dto.targetLeads,
        emailSequence: dto.emailSequence,
        linkedinSequence: dto.linkedinSequence,
        active: dto.active,
      },
    });

    // filterId is a relation scalar, so it goes through a scoped `update`
    // instead. Guarded by the ownership check above having matched.
    if (dto.filterId !== undefined) {
      await this.prisma.campaign.update({ where: { id }, data: { filterId: dto.filterId } });
    }

    return this.findOne(user, id);
  }

  @Delete(":id")
  @Roles(Role.ADMIN)
  async remove(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    // deleteMany, scoped by org, for the same reason as update.
    const res = await this.prisma.campaign.deleteMany({ where: { id, orgId: user.orgId } });
    return { deleted: res.count };
  }
}
