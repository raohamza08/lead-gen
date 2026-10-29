import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { JwtClaims } from "@leadgen/types";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { ModuleAccessGuard } from "../../common/guards/module-access.guard";
import { PrimaryAdminGuard } from "../../common/guards/primary-admin.guard";
import { RequiresModule } from "../../common/decorators/requires-module.decorator";
import { RequiresPrimaryAdmin } from "../../common/decorators/requires-primary-admin.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { PrismaService } from "../../common/prisma/prisma.service";
import { WhatsAppQrSessionManagerService } from "./whatsapp-qr-session-manager.service";

/**
 * QR connect/session lifecycle for the WhatsApp Team Inbox (Part: WhatsApp
 * Team Inbox, 2026-10-26) -- deliberately separate from
 * SocialMediaSettingsController's OAuth-shaped account connect flow, which
 * doesn't apply here at all (no authorization code, no redirect). Everyday
 * inbox reading/replying goes through the existing, platform-generic
 * SocialInboxController -- this controller only exists for the
 * QR-specific connect/status/logout steps.
 */
@Controller("social-media/whatsapp-qr")
@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule("SOCIAL_MEDIA")
export class WhatsAppQrController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: WhatsAppQrSessionManagerService,
  ) {}

  // Add/connect/disconnect a shared WhatsApp number is primary-admin-only,
  // not just any Role.ADMIN (Part: connect-accounts primary-admin-only,
  // 2026-10-27, explicit user request — "hide the adding or connecting
  // accounts for all the user except me") -- startSession/reconnectSession
  // previously had NO role check at all (anyone with Social Media access
  // could start a brand-new QR session), and logout only checked the
  // broader Role.ADMIN. getStatus (read-only) is untouched.
  @Post("sessions")
  @UseGuards(PrimaryAdminGuard)
  @RequiresPrimaryAdmin()
  async startSession(@CurrentUser() user: JwtClaims, @Body() body: { label?: string }) {
    return this.sessions.startNewSession(user.orgId, user.sub, body.label);
  }

  @Post("sessions/:accountId/reconnect")
  @UseGuards(PrimaryAdminGuard)
  @RequiresPrimaryAdmin()
  async reconnectSession(@CurrentUser() user: JwtClaims, @Param("accountId") accountId: string) {
    await this.assertAccount(user, accountId);
    await this.sessions.reconnectSession(accountId, user.sub);
    return { reconnecting: true };
  }

  @Get("sessions/:accountId/status")
  async getStatus(@CurrentUser() user: JwtClaims, @Param("accountId") accountId: string) {
    const account = await this.assertAccount(user, accountId);
    const session = await this.prisma.whatsAppQrSession.findUnique({ where: { socialAccountId: accountId } });
    return {
      accountId,
      phoneNumber: account.externalAccountId,
      status: session?.status ?? "DISCONNECTED",
      socketLive: this.sessions.getStatus(accountId) === "live",
      // Lets the Numbers tab show a scannable code just from having the
      // page open -- no modal, no click required (Part: WhatsApp Team
      // Inbox reliability, 2026-10-29) -- cleared the moment the session
      // actually connects (see handleConnectionUpdate's own docblock).
      pendingQrDataUrl: session?.status === "QR_PENDING" ? session.pendingQrDataUrl : null,
    };
  }

  @Post("sessions/:accountId/logout")
  @UseGuards(PrimaryAdminGuard)
  @RequiresPrimaryAdmin()
  async logout(@CurrentUser() user: JwtClaims, @Param("accountId") accountId: string) {
    await this.assertAccount(user, accountId);
    await this.sessions.logout(accountId);
    return { loggedOut: true };
  }

  private async assertAccount(user: JwtClaims, accountId: string) {
    const account = await this.prisma.socialAccount.findFirst({
      where: { id: accountId, orgId: user.orgId, platform: "WHATSAPP_QR" },
    });
    if (!account) throw new NotFoundException("WhatsApp number not found");
    return account;
  }
}
