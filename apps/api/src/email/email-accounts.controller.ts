import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { EmailAccountsService } from "./email-accounts.service";
import { UpsertEmailAccountDto } from "./dto/upsert-email-account.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims, Role } from "@leadgen/types";

/** Part E2: `GET/PATCH /api/v1/settings/email-accounts` — Admin full, Manager view-only (Part A4 RBAC table). */
@Controller("settings/email-accounts")
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmailAccountsController {
  constructor(private readonly service: EmailAccountsService) {}

  @Get()
  findAll(@CurrentUser() user: JwtClaims) {
    return this.service.findAllForOrg(user.orgId);
  }

  @Get("health")
  health(@CurrentUser() user: JwtClaims) {
    return this.service.health(user.orgId);
  }

  @Post()
  @Roles(Role.ADMIN)
  create(@CurrentUser() user: JwtClaims, @Body() dto: UpsertEmailAccountDto) {
    return this.service.create(user.orgId, dto);
  }

  @Patch(":id")
  @Roles(Role.ADMIN)
  update(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: UpsertEmailAccountDto) {
    return this.service.update(user.orgId, id, dto);
  }
}
