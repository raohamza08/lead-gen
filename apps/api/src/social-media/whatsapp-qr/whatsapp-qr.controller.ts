import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { JwtClaims, Role } from "@leadgen/types";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { ModuleAccessGuard } from "../../common/guards/module-access.guard";
import { RequiresModule } from "../../common/decorators/requires-module.decorator";
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

  @Post("sessions")
  async startSession(@CurrentUser() user: JwtClaims, @Body() body: { label?: string }) {
    const label = body.label?.trim() || "WhatsApp Number";
    return this.sessions.startNewSession(user.orgId, user.sub, label);
  }

  @Post("sessions/:accountId/reconnect")
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
    };
  }

  @Post("sessions/:accountId/logout")
  async logout(@CurrentUser() user: JwtClaims, @Param("accountId") accountId: string) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException("Only an admin can disconnect a shared WhatsApp number.");
    }
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
