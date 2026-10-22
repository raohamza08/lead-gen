import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtClaims } from "@leadgen/types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { EncryptionService } from "../../common/crypto/encryption.service";
import { AuditLogService } from "../../audit-log/audit-log.service";
import { apiPublicUrl } from "../../common/api-url";
import { dashboardUrl } from "../../common/cors";
import { UpworkOAuthClient } from "./upwork-oauth.client";
import { UpworkOAuthStateStore } from "./upwork-oauth-state.store";
import { UpworkGraphQLClient, UpworkGraphQLError } from "../shared/upwork-graphql.client";

/**
 * Owns "connect / status / disconnect" for the single org-wide Upwork API
 * connection — mirrors MetaAdsService's own split (connect/CRUD here, actual
 * data sync left to per-domain services once Upwork approves the app and
 * each one's real implementation can be written against a confirmed schema).
 *
 * Every route that reaches this service is already behind the standard
 * JwtAuthGuard + RolesGuard + ModuleAccessGuard stack (see
 * upwork-api.controller.ts) — no additional role/ownership re-check here
 * beyond what MetaAdsService itself re-checks at its callback (the
 * connecting user's session could still have been deactivated while the
 * browser was off on Upwork's consent screen).
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
    private readonly graphql: UpworkGraphQLClient,
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
      // Best-effort — see UpworkGraphQLClient's own docblock for why a
      // failure here never blocks the connection itself.
      const org = await this.graphql.getDefaultOrganization(token.accessToken);

      await this.prisma.upworkApiConnection.upsert({
        where: { orgId: pending.orgId },
        create: {
          orgId: pending.orgId,
          accessTokenEnc: this.encryption.encrypt(token.accessToken),
          refreshTokenEnc: this.encryption.encrypt(token.refreshToken),
          tokenExpiresAt,
          scope: token.scope,
          organizationId: org?.organizationId,
          organizationName: org?.title,
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
          organizationId: org?.organizationId,
          organizationName: org?.title,
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
    // Real bug, not a frontend issue (found 2026-10-22 investigating "the
    // disconnect button isn't working"): `connected` used to be hardcoded
    // `true` here whenever a connection ROW existed at all, regardless of
    // its `status`. disconnect() deliberately keeps the row (for history/
    // audit, doesn't delete it) and only flips `status` to DISCONNECTED --
    // so this endpoint kept reporting `connected: true` forever after the
    // very first connect, and the Settings page's button never switched
    // back to "Connect Upwork account" no matter how many times someone
    // disconnected. Confirmed live: disconnect() itself worked correctly
    // every time (status really did flip to DISCONNECTED in the database,
    // audit log recorded each call) -- only this read was wrong.
    return {
      connected: connection.status === "CONNECTED",
      status: connection.status,
      scope: connection.scope,
      organizationId: connection.organizationId,
      organizationName: connection.organizationName,
      connectedAt: connection.connectedAt,
      tokenExpiresAt: connection.tokenExpiresAt,
      lastSyncAt: connection.lastSyncAt,
      lastSyncError: connection.lastSyncError,
    };
  }

  /** Manual organization-ID override (Part: Upwork API integration,
   *  2026-10-22, real bug found — see UpworkGraphQLClient.getOrganizationName's
   *  own docblock: the automatic `companySelector` lookup this app would
   *  otherwise rely on is blocked by a scope this app's Upwork permissions
   *  don't include, so every GraphQL call silently defaulted to the
   *  authenticating user's PERSONAL account instead of any agency they
   *  belong to). Validates the given ID by actually calling Upwork with it
   *  as X-Upwork-API-TenantId and reading back the real organization name —
   *  a typo'd/wrong ID surfaces as a real Upwork error here, not a silent
   *  no-op, same fail-loud principle as every other write in this service. */
  async setOrganizationId(user: JwtClaims, organizationId: string) {
    const { accessToken } = await this.getValidAccessToken(user.orgId);
    const organizationName = await this.graphql.getOrganizationName(accessToken, organizationId);
    await this.prisma.upworkApiConnection.update({
      where: { orgId: user.orgId },
      data: { organizationId, organizationName },
    });
    this.auditLog.write({
      orgId: user.orgId,
      actorId: user.sub,
      action: "UPWORK_API_ORGANIZATION_ID_SET",
      entityType: "upworkApiConnection",
      entityId: user.orgId,
      metadata: { organizationId, organizationName },
    });
    return { organizationId, organizationName };
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

  /** Decrypts and returns a live access token for the org's connection,
   *  proactively refreshing it first if it's within 5 minutes of our OWN
   *  stored `tokenExpiresAt`. Also returns organizationId so callers can
   *  set it as the X-Upwork-API-TenantId header (confirmed from Upwork's
   *  docs — see the schema's own docblock on UpworkApiConnection); null
   *  there just means the header gets omitted and Upwork falls back to the
   *  user's default org, per the same docs. Throws if there's no
   *  connected, non-revoked account to use.
   *
   *  LOAD-BEARING LIMITATION, confirmed live 2026-10-22 (real bug, found
   *  investigating the first proposals backfill's 401s): this proactive
   *  check only protects against OUR OWN `tokenExpiresAt` estimate running
   *  out — it does nothing if Upwork's actual token lifetime is shorter
   *  than what we computed from their token response's `expires_in`
   *  (confirmed: a token well within our own 24h-out `tokenExpiresAt`
   *  still got a real 401 "Authentication failed" from Upwork on a fresh
   *  call). Don't rely on this method alone for a call that MUST succeed —
   *  use `withFreshTokenOnAuthFailure` below, which reactively force-
   *  refreshes and retries once on an actual 401 from Upwork, regardless
   *  of what our own stored expiry says. */
  async getValidAccessToken(orgId: string): Promise<{ accessToken: string; organizationId: string | null }> {
    const connection = await this.prisma.upworkApiConnection.findUnique({ where: { orgId } });
    if (!connection || connection.status !== "CONNECTED") {
      throw new BadRequestException("No active Upwork API connection — connect one in Settings > Upwork API first.");
    }

    const expiresSoon = connection.tokenExpiresAt.getTime() - Date.now() < 5 * 60 * 1000;
    if (!expiresSoon) {
      return { accessToken: this.encryption.decrypt(connection.accessTokenEnc), organizationId: connection.organizationId };
    }
    return this.forceRefreshAccessToken(orgId);
  }

  /** Unconditionally exchanges the stored refresh token for a new access
   *  token, regardless of what our own `tokenExpiresAt` says (Part: real
   *  bug fix, 2026-10-22 — see getValidAccessToken's own docblock). Shares
   *  the exact refresh-and-persist logic getValidAccessToken's proactive
   *  path already used, just callable unconditionally too. */
  async forceRefreshAccessToken(orgId: string): Promise<{ accessToken: string; organizationId: string | null }> {
    const connection = await this.prisma.upworkApiConnection.findUnique({ where: { orgId } });
    if (!connection || connection.status !== "CONNECTED") {
      throw new BadRequestException("No active Upwork API connection — connect one in Settings > Upwork API first.");
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
      return { accessToken: token.accessToken, organizationId: connection.organizationId };
    } catch (err) {
      await this.prisma.upworkApiConnection.update({
        where: { orgId },
        data: { status: "EXPIRED", lastSyncError: (err as Error).message.slice(0, 300) },
      });
      throw err;
    }
  }

  /** Runs `fn` with a valid token, and if Upwork itself rejects that token
   *  with a 401 (regardless of what our own stored `tokenExpiresAt` claims
   *  — see getValidAccessToken's own docblock for why that can't always be
   *  trusted), force-refreshes once and retries `fn` exactly once more
   *  before giving up. This is what every sync service should use instead
   *  of calling getValidAccessToken directly, for exactly one real call
   *  that must succeed if the connection is genuinely still valid. */
  async withFreshTokenOnAuthFailure<T>(
    orgId: string,
    fn: (token: { accessToken: string; organizationId: string | null }) => Promise<T>,
  ): Promise<T> {
    const token = await this.getValidAccessToken(orgId);
    try {
      return await fn(token);
    } catch (err) {
      if (err instanceof UpworkGraphQLError && err.status === 401) {
        this.logger.warn(`Upwork rejected a token for org ${orgId} with 401 despite our own tokenExpiresAt saying it was valid — force-refreshing and retrying once.`);
        const refreshed = await this.forceRefreshAccessToken(orgId);
        return fn(refreshed);
      }
      throw err;
    }
  }
}
