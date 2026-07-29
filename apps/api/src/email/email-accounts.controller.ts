import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
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

  /**
   * Sends a real test email through this mailbox to the signed-in user.
   *
   * Sending for real, rather than merely checking the credentials parse, is the
   * point: SMTP auth can succeed while the provider still refuses to relay, and
   * an app password can be valid but scoped wrongly. Both only surface on an
   * actual send — and discovering them partway through a live campaign means
   * failed sends against real prospects.
   *
   * Deliberately bypasses the compliance gate: the recipient is the operator's
   * own address, so suppression lists and unsubscribe links do not apply, and
   * running the gate here would block the test for the wrong reason.
   */
  @Post(":id/test")
  @Roles(Role.ADMIN)
  sendTest(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.sendTest(user.orgId, id, user.email);
  }

  @Delete(":id")
  @Roles(Role.ADMIN)
  remove(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.remove(user.orgId, id);
  }
}
