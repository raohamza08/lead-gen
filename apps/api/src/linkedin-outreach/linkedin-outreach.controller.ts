import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { JwtClaims } from "@leadgen/types";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { ModuleAccessGuard } from "../common/guards/module-access.guard";
import { PrimaryAdminGuard } from "../common/guards/primary-admin.guard";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { RequiresPrimaryAdmin } from "../common/decorators/requires-primary-admin.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { LinkedinOutreachSessionService } from "./services/linkedin-outreach-session.service";

/**
 * Claim/release/status for the one persistent, shared LinkedIn browser
 * session per org (Part: LinkedIn Outreach). Live mouse/keyboard control
 * goes over the socket (RealtimeGateway's `linkedinSession.input` handler),
 * not through here — see that handler's docblock for why REST isn't used
 * for that one piece.
 */
@Controller("linkedin-outreach")
@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule("LINKEDIN_OUTREACH")
export class LinkedinOutreachController {
  constructor(private readonly sessions: LinkedinOutreachSessionService) {}

  @Get("status")
  getStatus(@CurrentUser() user: JwtClaims) {
    return this.sessions.getStatus(user.orgId);
  }

  @Post("claim")
  claim(@CurrentUser() user: JwtClaims) {
    return this.sessions.claim(user.orgId, user.sub);
  }

  @Post("takeover")
  takeover(@CurrentUser() user: JwtClaims) {
    return this.sessions.claim(user.orgId, user.sub, { force: true });
  }

  @Post("release")
  async release(@CurrentUser() user: JwtClaims) {
    await this.sessions.release(user.orgId, user.sub);
    return { released: true };
  }

  // Destructive — wipes the on-disk LinkedIn session, forcing a fresh login
  // next time anyone claims it. Same primary-admin-only gating as WhatsApp
  // QR's logout route (connect/disconnect-type actions on a shared asset).
  @Post("logout")
  @UseGuards(PrimaryAdminGuard)
  @RequiresPrimaryAdmin()
  async logout(@CurrentUser() user: JwtClaims) {
    await this.sessions.logoutAndReset(user.orgId, user.sub);
    return { loggedOut: true };
  }
}
