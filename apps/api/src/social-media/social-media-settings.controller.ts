import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { SocialPlatform } from "@prisma/client";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { ModuleAccessGuard } from "../common/guards/module-access.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims, Role } from "@leadgen/types";
import { SocialMediaService } from "./social-media.service";
import { CreateSocialAccountDto, GrantSocialAccountAccessDto, UpdateSocialAccountSettingsDto } from "./dto/social-account.dto";

/** `/settings/social-media` — account-level configuration, admin-managed, split out from the day-to-day `/social-media` API (same pattern as `/settings/email-accounts` vs `/email-hub`). */
@Controller("settings/social-media")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule("SOCIAL_MEDIA")
export class SocialMediaSettingsController {
  constructor(private readonly service: SocialMediaService) {}

  @Get("accounts")
  listAccounts(@CurrentUser() user: JwtClaims) {
    return this.service.listAccounts(user);
  }

  @Post("accounts")
  @Roles(Role.ADMIN)
  createAccount(@CurrentUser() user: JwtClaims, @Body() dto: CreateSocialAccountDto) {
    return this.service.createAccountPlaceholder(user.orgId, dto);
  }

  // Both "pending" routes must come before ":id"/":platform" below — same
  // reasoning as leads.controller.ts's "export" — otherwise Nest matches
  // "pending" as the :id/:platform param and these routes are never reached.
  @Get("accounts/pending/:id")
  @Roles(Role.ADMIN)
  getPendingSelection(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.getPendingSelection(user, id);
  }

  @Post("accounts/pending/:id/select")
  @Roles(Role.ADMIN)
  selectPendingAccount(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body("externalAccountId") externalAccountId: string) {
    return this.service.selectPendingAccount(user, id, externalAccountId);
  }

  @Patch("accounts/:id")
  @Roles(Role.ADMIN)
  updateAccount(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: UpdateSocialAccountSettingsDto) {
    return this.service.updateAccountSettings(user.orgId, id, dto);
  }

  @Post("accounts/:id/disconnect")
  @Roles(Role.ADMIN)
  disconnect(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.disconnectAccount(user, id);
  }

  @Delete("accounts/:id")
  @Roles(Role.ADMIN)
  deleteAccount(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.deleteAccount(user, id);
  }

  @Post("accounts/:id/subscribe-webhook")
  @Roles(Role.ADMIN)
  subscribeWebhook(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.subscribeAccountWebhook(user, id);
  }

  /** Returns the platform's real OAuth consent URL — the frontend redirects the browser to it. */
  @Post("accounts/:platform/connect")
  @Roles(Role.ADMIN)
  connect(@CurrentUser() user: JwtClaims, @Param("platform") platform: SocialPlatform) {
    return this.service.initiateConnect(user, platform);
  }

  @Get("accounts/:id/access")
  @Roles(Role.ADMIN)
  listAccess(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.listAccessForAccount(user.orgId, id);
  }

  @Post("accounts/:id/access")
  @Roles(Role.ADMIN)
  grantAccess(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: GrantSocialAccountAccessDto) {
    return this.service.grantAccess(user.orgId, id, dto);
  }

  @Delete("accounts/:id/access/:userId")
  @Roles(Role.ADMIN)
  revokeAccess(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Param("userId") userId: string) {
    return this.service.revokeAccess(user.orgId, id, userId);
  }
}
