import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcryptjs";
import { randomBytes, createHash } from "crypto";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuthTokens, JwtClaims, Role } from "@leadgen/types";
import { AuditLogService } from "../audit-log/audit-log.service";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly auditLog: AuditLogService,
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
      throw new UnauthorizedException("Invalid credentials");
    }
    this.auditLog.write({ orgId: user.orgId, actorId: user.id, action: "LOGIN", entityType: "auth", ipAddress });
    return this.issueTokens({ sub: user.id, orgId: user.orgId, role: user.role as Role, email: user.email });
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
