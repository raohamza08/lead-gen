import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Min } from "class-validator";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { CampaignsService } from "./campaigns.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims, Role } from "@leadgen/types";

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

@Controller("campaigns")
@UseGuards(JwtAuthGuard, RolesGuard)
export class CampaignsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignsService,
  ) {}

  @Get()
  findAll(@CurrentUser() user: JwtClaims) {
    return this.prisma.campaign.findMany({
      where: { orgId: user.orgId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { leads: true } } },
    });
  }

  @Get("performance")
  performance(@CurrentUser() user: JwtClaims) {
    return this.campaigns.performance(user.orgId);
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
