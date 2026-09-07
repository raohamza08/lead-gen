import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { SocialPlatform } from "@prisma/client";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { ModuleAccessGuard } from "../common/guards/module-access.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims, Role } from "@leadgen/types";
import { SocialMediaService } from "./social-media.service";
import { SocialOAuthAppService } from "./social-oauth-app.service";
import { CreateSocialAccountDto, GrantSocialAccountAccessDto, UpdateSocialAccountSettingsDto } from "./dto/social-account.dto";
import { CreateSocialOAuthAppDto } from "./dto/social-oauth-app.dto";

/** `/settings/social-media` — account-level configuration, admin-managed, split out from the day-to-day `/social-media` API (same pattern as `/settings/email-accounts` vs `/email-hub`). */
@Controller("settings/social-media")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule("SOCIAL_MEDIA")
export class SocialMediaSettingsController {
  constructor(
    private readonly service: SocialMediaService,
    private readonly oauthApps: SocialOAuthAppService,
  ) {}

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

  /** Returns the platform's real OAuth consent URL — the frontend redirects the browser to it.
   *  `oauthAppId` is optional (Part: per-account OAuth app credentials, 2026-09-07) — omitted
   *  means "use the platform-wide default app," unchanged from before this existed. */
  @Post("accounts/:platform/connect")
  @Roles(Role.ADMIN)
  connect(@CurrentUser() user: JwtClaims, @Param("platform") platform: SocialPlatform, @Body("oauthAppId") oauthAppId?: string) {
    return this.service.initiateConnect(user, platform, undefined, oauthAppId);
  }

  // OAuth apps -- an org's own custom credentials per platform, offered as
  // an alternative to the platform-wide default app (Part: per-account
  // OAuth app credentials, 2026-09-07). Listed here rather than a separate
  // route/module since they're pure account-connect configuration, same
  // admin-only scope as everything else in this controller.
  @Get("oauth-apps")
  @Roles(Role.ADMIN)
  listOAuthApps(@CurrentUser() user: JwtClaims, @Query("platform") platform?: SocialPlatform) {
    return this.oauthApps.list(user.orgId, platform);
  }

  @Post("oauth-apps")
  @Roles(Role.ADMIN)
  createOAuthApp(@CurrentUser() user: JwtClaims, @Body() dto: CreateSocialOAuthAppDto) {
    return this.oauthApps.create(user.orgId, user.sub, dto);
  }

  @Delete("oauth-apps/:id")
  @Roles(Role.ADMIN)
  deleteOAuthApp(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.oauthApps.delete(user.orgId, id);
  }

  @Get("accounts/:id/access")
  @Roles(Role.ADMIN)
  listAccess(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.listAccessForAccount(user.orgId, id);
  }

  @Post("accounts/:id/access")
  @Roles(Role.ADMIN)
  grantAccess(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: GrantSocialAccountAccessDto) {
    return this.service.grantAccess(user.sub, user.orgId, id, dto);
  }

  @Delete("accounts/:id/access/:userId")
  @Roles(Role.ADMIN)
  revokeAccess(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Param("userId") userId: string) {
    return this.service.revokeAccess(user.sub, user.orgId, id, userId);
  }
}
