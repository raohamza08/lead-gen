import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { SocialPlatform } from "@prisma/client";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims, Role } from "@leadgen/types";
import { SocialMediaService } from "./social-media.service";
import { CreateSocialAccountDto, GrantSocialAccountAccessDto, UpdateSocialAccountSettingsDto } from "./dto/social-account.dto";

/** `/settings/social-media` — account-level configuration, admin-managed, split out from the day-to-day `/social-media` API (same pattern as `/settings/email-accounts` vs `/email-hub`). */
@Controller("settings/social-media")
@UseGuards(JwtAuthGuard, RolesGuard)
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
