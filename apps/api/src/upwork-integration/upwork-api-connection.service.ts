import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtClaims } from "@leadgen/types";
import { PrismaService } from "../common/prisma/prisma.service";
import { EncryptionService } from "../common/crypto/encryption.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import { apiPublicUrl } from "../common/api-url";
import { dashboardUrl } from "../common/cors";
import { UpworkOAuthClient } from "./upwork-oauth.client";
import { UpworkOAuthStateStore } from "./upwork-oauth-state.store";

/**
 * Owns "connect / status / disconnect" for the single org-wide Upwork API
 * connection — mirrors MetaAdsService's own split (connect/CRUD here, actual
 * data sync left to per-domain services once Upwork approves the app and
 * each one's real implementation can be written against a confirmed schema).
 *
 * Every route that reaches this service is already behind
 * UpworkApiOwnerGuard (see upwork-api.controller.ts) — no additional
 * role/ownership re-check here beyond what MetaAdsService itself re-checks
 * at its callback (the connecting user's session could still have been
 * deactivated while the browser was off on Upwork's consent screen).
 */
@Injectable()
export class UpworkApiConnectionService {
  private readonly logger = new Logger(UpworkApiConnectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
    private readonly auditLog: AuditLogService,
    private readonly client: UpworkOAuthClient,
    private readonly oauthState: UpworkOAuthStateStore,
  ) {}

  private callbackRedirectUri(): string {
    return `${apiPublicUrl()}/upwork-oauth/callback`;
  }

  private settingsUrl(): string {
    return `${dashboardUrl()}/settings/upwork-api`;
  }

  private credentials(): { clientId: string; clientSecret: string } {
    const clientId = this.config.get<string>("UPWORK_OAUTH_CLIENT_ID");
    const clientSecret = this.config.get<string>("UPWORK_OAUTH_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      throw new BadRequestException(
        "Upwork API isn't configured yet — set UPWORK_OAUTH_CLIENT_ID/SECRET once the app is approved.",
      );
    }
    return { clientId, clientSecret };
  }

  /** The callback URL Upwork's app-registration form needs — surfaced
   *  through the API so it's always read off the real running config
   *  instead of re-typed by hand somewhere and risking drift. */
  getCallbackUrl(): { callbackUrl: string } {
    return { callbackUrl: this.callbackRedirectUri() };
  }

  initiateConnect(user: JwtClaims): { url: string } {
    const { clientId } = this.credentials();
    const state = this.oauthState.create({ orgId: user.orgId, userId: user.sub });
    const url = this.client.getAuthorizeUrl(clientId, state, this.callbackRedirectUri());
    return { url };
  }

  async handleOAuthCallback(code: string | undefined, state: string | undefined): Promise<string> {
    const settingsUrl = this.settingsUrl();
    if (!code || !state) {
      return `${settingsUrl}?upwork_api_error=${encodeURIComponent("Missing code/state from Upwork")}`;
    }

    const pending = this.oauthState.consume(state);
    if (!pending) {
      return `${settingsUrl}?upwork_api_error=${encodeURIComponent("This connection request expired or is invalid — please try again")}`;
    }

    try {
      const { clientId, clientSecret } = this.credentials();
      const token = await this.client.exchangeCodeForToken(clientId, clientSecret, code, this.callbackRedirectUri());
      const tokenExpiresAt = new Date(Date.now() + token.expiresInSec * 1000);

      await this.prisma.upworkApiConnection.upsert({
        where: { orgId: pending.orgId },
        create: {
          orgId: pending.orgId,
          accessTokenEnc: this.encryption.encrypt(token.accessToken),
          refreshTokenEnc: this.encryption.encrypt(token.refreshToken),
          tokenExpiresAt,
          scope: token.scope,
          status: "CONNECTED",
          connectedByUserId: pending.userId,
          connectedAt: new Date(),
          lastSyncError: null,
        },
        update: {
          accessTokenEnc: this.encryption.encrypt(token.accessToken),
          refreshTokenEnc: this.encryption.encrypt(token.refreshToken),
          tokenExpiresAt,
          scope: token.scope,
          status: "CONNECTED",
          connectedByUserId: pending.userId,
          connectedAt: new Date(),
          lastSyncError: null,
        },
      });

      this.auditLog.write({
        orgId: pending.orgId,
        actorId: pending.userId,
        action: "UPWORK_API_CONNECTED",
        entityType: "upworkApiConnection",
        entityId: pending.orgId,
      });

      return `${settingsUrl}?upwork_api_connected=1`;
    } catch (err) {
      this.logger.warn(`Upwork API OAuth callback failed: ${(err as Error).message}`);
      return `${settingsUrl}?upwork_api_error=${encodeURIComponent((err as Error).message.slice(0, 300))}`;
    }
  }

  async getStatus(orgId: string) {
    const connection = await this.prisma.upworkApiConnection.findUnique({ where: { orgId } });
    if (!connection) return { connected: false as const };
    return {
      connected: true as const,
      status: connection.status,
      scope: connection.scope,
      connectedAt: connection.connectedAt,
      tokenExpiresAt: connection.tokenExpiresAt,
      lastSyncAt: connection.lastSyncAt,
      lastSyncError: connection.lastSyncError,
    };
  }

  async disconnect(user: JwtClaims) {
    const connection = await this.prisma.upworkApiConnection.findUnique({ where: { orgId: user.orgId } });
    if (!connection) return { disconnected: true };
    await this.prisma.upworkApiConnection.update({
      where: { orgId: user.orgId },
      data: { status: "DISCONNECTED", accessTokenEnc: "", refreshTokenEnc: "" },
    });
    this.auditLog.write({
      orgId: user.orgId,
      actorId: user.sub,
      action: "UPWORK_API_DISCONNECTED",
      entityType: "upworkApiConnection",
      entityId: connection.id,
    });
    return { disconnected: true };
  }

  /** Decrypts and returns a live, non-expired access token for the org's
   *  connection, refreshing it first if it's within 5 minutes of expiry —
   *  this is what every per-domain service in ./services/ will call once
   *  its stub is replaced with a real implementation. Throws if there's no
   *  connected, non-revoked account to use. */
  async getValidAccessToken(orgId: string): Promise<string> {
    const connection = await this.prisma.upworkApiConnection.findUnique({ where: { orgId } });
    if (!connection || connection.status !== "CONNECTED") {
      throw new BadRequestException("No active Upwork API connection — connect one in Settings > Upwork API first.");
    }

    const expiresSoon = connection.tokenExpiresAt.getTime() - Date.now() < 5 * 60 * 1000;
    if (!expiresSoon) {
      return this.encryption.decrypt(connection.accessTokenEnc);
    }

    const { clientId, clientSecret } = this.credentials();
    const refreshToken = this.encryption.decrypt(connection.refreshTokenEnc);
    try {
      const token = await this.client.refreshAccessToken(clientId, clientSecret, refreshToken);
      const tokenExpiresAt = new Date(Date.now() + token.expiresInSec * 1000);
      await this.prisma.upworkApiConnection.update({
        where: { orgId },
        data: {
          accessTokenEnc: this.encryption.encrypt(token.accessToken),
          refreshTokenEnc: this.encryption.encrypt(token.refreshToken),
          tokenExpiresAt,
          lastSyncError: null,
        },
      });
      return token.accessToken;
    } catch (err) {
      await this.prisma.upworkApiConnection.update({
        where: { orgId },
        data: { status: "EXPIRED", lastSyncError: (err as Error).message.slice(0, 300) },
      });
      throw err;
    }
  }
}
