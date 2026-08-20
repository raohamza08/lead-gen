import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims, Role } from "@leadgen/types";
import { CaseStudiesService } from "./case-studies.service";
import { CreateCaseStudyDto } from "./dto/create-case-study.dto";

@Controller("settings/case-studies")
@UseGuards(JwtAuthGuard, RolesGuard)
export class CaseStudiesController {
  constructor(private readonly caseStudies: CaseStudiesService) {}

  @Get()
  findAll(@CurrentUser() user: JwtClaims) {
    return this.caseStudies.findAll(user.orgId);
  }

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  create(@CurrentUser() user: JwtClaims, @Body() dto: CreateCaseStudyDto) {
    return this.caseStudies.create(user.orgId, dto);
  }

  @Post(":id/retry")
  @Roles(Role.ADMIN, Role.MANAGER)
  retry(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.caseStudies.retry(user.orgId, id);
  }

  @Delete(":id")
  @Roles(Role.ADMIN, Role.MANAGER)
  remove(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.caseStudies.remove(user.orgId, id);
  }
}
