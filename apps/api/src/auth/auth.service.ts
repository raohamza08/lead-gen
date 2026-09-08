import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcryptjs";
import { randomBytes, createHash } from "crypto";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuthTokens, JwtClaims, Role } from "@leadgen/types";
import { NotificationCategory } from "@prisma/client";
import { AuditLogService } from "../audit-log/audit-log.service";
import { NotificationsService } from "../notifications/notifications.service";

/** How many LOGIN_FAILED attempts for the same email, within this window,
 *  before a SECURITY alert fires (Part: comprehensive operational alerting,
 *  2026-09-08). Checked only at exactly this count, not "5 or more" -- a
 *  sustained attack keeps failing past 5 too, and re-alerting on every
 *  single one of those would just be noise once the admin already knows. */
const LOGIN_FAILURE_ALERT_THRESHOLD = 5;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly auditLog: AuditLogService,
    private readonly notifications: NotificationsService,
  ) {}

  async login(email: string, password: string, ipAddress?: string): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.active) {
      this.auditLog.write({
        action: "LOGIN_FAILED",
        entityType: "auth",
        result: "FAILURE",
        ipAddress,
        metadata: { email, reason: user ? "inactive account" : "unknown email" },
      });
      await this.maybeAlertRepeatedFailures(email, ipAddress, user?.orgId);
      throw new UnauthorizedException("Invalid credentials");
    }
    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk) {
      this.auditLog.write({
        orgId: user.orgId,
        actorId: user.id,
        action: "LOGIN_FAILED",
        entityType: "auth",
        result: "FAILURE",
        ipAddress,
        metadata: { email, reason: "wrong password" },
      });
      await this.maybeAlertRepeatedFailures(email, ipAddress, user.orgId);
      throw new UnauthorizedException("Invalid credentials");
    }
    this.auditLog.write({ orgId: user.orgId, actorId: user.id, action: "LOGIN", entityType: "auth", ipAddress });
    return this.issueTokens({ sub: user.id, orgId: user.orgId, role: user.role as Role, email: user.email });
  }

  /** `orgId` is only known when the attempted email matches a real (if
   *  inactive or wrong-password) user -- for a genuinely unknown email there
   *  is no org to scope the alert to, so this falls back to whichever
   *  organization was created first. Correct for this single-tenant
   *  deployment; a real multi-tenant version would need a different
   *  resolution here entirely (there's no tenant to attribute an
   *  unknown-email probe to). */
  private async maybeAlertRepeatedFailures(email: string, ipAddress: string | undefined, orgId: string | undefined) {
    // +1 for the attempt that just failed, not (only) what's already
    // persisted -- AuditLogService.write() above is deliberately
    // fire-and-forget (never awaited, by design: an audit-log failure must
    // never fail the login response), so its own INSERT can still be
    // in-flight when this query runs. Counting the DB rows alone under a
    // fast burst would undercount by however many writes hadn't landed yet
    // -- confirmed live, a 5-attempt burst never crossed the threshold
    // until this fix.
    const priorCount = await this.prisma.auditLog.count({
      where: {
        action: "LOGIN_FAILED",
        createdAt: { gte: new Date(Date.now() - LOGIN_FAILURE_WINDOW_MS) },
        metadata: { path: ["email"], equals: email },
      },
    });
    const count = priorCount + 1;
    if (count < LOGIN_FAILURE_ALERT_THRESHOLD) return;

    const targetOrgId = orgId ?? (await this.prisma.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }))?.id;
    if (!targetOrgId) return;

    // `>=`, not `===` -- concurrent requests racing the same priorCount
    // query could otherwise all land on the same value and skip past the
    // exact threshold without any of them firing. Dedup instead on whether
    // an alert already exists for this email in the window (entityId
    // doubles as the lookup key here), so a burst crossing the threshold
    // fires exactly once regardless of how many requests raced past it
    // simultaneously.
    const alreadyAlerted = await this.prisma.notification.findFirst({
      where: {
        type: "REPEATED_LOGIN_FAILURES",
        entityId: email,
        createdAt: { gte: new Date(Date.now() - LOGIN_FAILURE_WINDOW_MS) },
      },
    });
    if (alreadyAlerted) return;

    await this.notifications.notify(targetOrgId, {
      category: NotificationCategory.SECURITY,
      type: "REPEATED_LOGIN_FAILURES",
      severity: "ERROR",
      title: "Repeated failed login attempts",
      message: `${count} failed login attempts for ${email} in the last ${LOGIN_FAILURE_WINDOW_MS / 60000} minutes (most recent from ${ipAddress ?? "an unknown IP"}).`,
      entityType: "auth",
      entityId: email,
      actionUrl: "/admin/system-logs",
    });
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findFirst({
      where: { tokenHash, revoked: false, expiresAt: { gt: new Date() } },
      include: { user: true },
    });
    if (!stored) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }
    // Rotate: revoke the used token and issue a new pair (prevents replay).
    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } });
    const user = stored.user;
    return this.issueTokens({ sub: user.id, orgId: user.orgId, role: user.role as Role, email: user.email });
  }

  async logout(userId: string, orgId?: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { userId, revoked: false }, data: { revoked: true } });
    this.auditLog.write({ orgId, actorId: userId, action: "LOGOUT", entityType: "auth" });
  }

  private async issueTokens(claims: JwtClaims): Promise<AuthTokens> {
    const accessTtl = this.config.get<string>("JWT_ACCESS_TTL", "15m");
    const refreshTtl = this.config.get<string>("JWT_REFRESH_TTL", "7d");

    const accessToken = this.jwt.sign(claims, {
      secret: this.config.get<string>("JWT_ACCESS_SECRET"),
      expiresIn: accessTtl,
    });

    const rawRefreshToken = randomBytes(48).toString("hex");
    const tokenHash = this.hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + this.parseDurationMs(refreshTtl));

    await this.prisma.refreshToken.create({
      data: { userId: claims.sub, tokenHash, expiresAt },
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: this.parseDurationMs(accessTtl) / 1000,
    };
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private parseDurationMs(duration: string): number {
    const match = /^(\d+)([smhd])$/.exec(duration);
    if (!match) return 15 * 60 * 1000;
    const value = Number(match[1]);
    const unit = match[2];
    const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    return value * multipliers[unit];
  }
}
