import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { IsString, MaxLength, MinLength } from "class-validator";
import { JwtClaims } from "@leadgen/types";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { ModuleAccessGuard } from "../common/guards/module-access.guard";
import { PrimaryAdminGuard } from "../common/guards/primary-admin.guard";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { RequiresPrimaryAdmin } from "../common/decorators/requires-primary-admin.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { LinkedinOutreachSessionService } from "./services/linkedin-outreach-session.service";

class AddLinkedinAccountDto {
  @IsString() @MinLength(1) @MaxLength(60) label!: string;
}

/**
 * Lists, adds, and removes the org's connected LinkedIn accounts, plus
 * claim/release/status per account (Part: LinkedIn Outreach — extended
 * 2026-10-30 from a single shared org session to multiple named accounts).
 * Live mouse/keyboard control goes over the socket
 * (RealtimeGateway's `linkedinSession.input` handler), not through here —
 * see that handler's docblock for why REST isn't used for that one piece.
 */
@Controller("linkedin-outreach")
@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule("LINKEDIN_OUTREACH")
export class LinkedinOutreachController {
  constructor(private readonly sessions: LinkedinOutreachSessionService) {}

  @Get("accounts")
  listAccounts(@CurrentUser() user: JwtClaims) {
    return this.sessions.listAccounts(user.orgId);
  }

  @Post("accounts")
  addAccount(@CurrentUser() user: JwtClaims, @Body() body: AddLinkedinAccountDto) {
    return this.sessions.addAccount(user.orgId, user.sub, body.label);
  }

  // Destructive — wipes the on-disk profile and removes the account row
  // entirely. Same primary-admin-only gating as the per-account logout
  // route below (connect/disconnect-type actions on a shared asset).
  @Delete("accounts/:accountId")
  @UseGuards(PrimaryAdminGuard)
  @RequiresPrimaryAdmin()
  async removeAccount(@CurrentUser() user: JwtClaims, @Param("accountId") accountId: string) {
    await this.sessions.removeAccount(user.orgId, accountId, user.sub);
    return { removed: true };
  }

  @Post("accounts/:accountId/claim")
  claim(@CurrentUser() user: JwtClaims, @Param("accountId") accountId: string) {
    return this.sessions.claim(user.orgId, accountId, user.sub);
  }

  @Post("accounts/:accountId/takeover")
  takeover(@CurrentUser() user: JwtClaims, @Param("accountId") accountId: string) {
    return this.sessions.claim(user.orgId, accountId, user.sub, { force: true });
  }

  @Post("accounts/:accountId/release")
  async release(@CurrentUser() user: JwtClaims, @Param("accountId") accountId: string) {
    await this.sessions.release(user.orgId, accountId, user.sub);
    return { released: true };
  }

  // Destructive — wipes the on-disk LinkedIn session, forcing a fresh login
  // next time anyone claims this account. Same primary-admin-only gating as
  // WhatsApp QR's logout route (connect/disconnect-type actions on a shared
  // asset).
  @Post("accounts/:accountId/logout")
  @UseGuards(PrimaryAdminGuard)
  @RequiresPrimaryAdmin()
  async logout(@CurrentUser() user: JwtClaims, @Param("accountId") accountId: string) {
    await this.sessions.logoutAndReset(user.orgId, accountId, user.sub);
    return { loggedOut: true };
  }
}
