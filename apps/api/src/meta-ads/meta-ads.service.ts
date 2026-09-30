import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtClaims, Role } from "@leadgen/types";
import { PrismaService } from "../common/prisma/prisma.service";
import { EncryptionService } from "../common/crypto/encryption.service";
import { apiPublicUrl } from "../common/api-url";
import { dashboardUrl } from "../common/cors";
import { NotificationsService } from "../notifications/notifications.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import { MetaMarketingApiClient } from "./meta-marketing-api.client";
import { MetaAdsOAuthStateStore } from "./meta-ads-oauth-state.store";
import { MetaAdsPendingSelectionStore } from "./meta-ads-pending-selection.store";
import { SelectMetaAdAccountsDto } from "./dto/meta-ads.dto";

/** Backs the Meta Ads module's connect flow and connected-account CRUD —
 *  mirrors SocialMediaService's own OAuth section, but deliberately its own
 *  service/module rather than folded into it (Part: standing decision — Ads
 *  reporting is a separate connection from the Social Media Hub's
 *  posting/DM/engagement one, requesting a different scope). Sync logic
 *  (pulling campaigns/ad sets/ads/insights) lives in MetaAdsSyncService, not
 *  here — this file only owns "connect, list, disconnect." */
@Injectable()
export class MetaAdsService {
  private readonly logger = new Logger(MetaAdsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
    private readonly notifications: NotificationsService,
    private readonly auditLog: AuditLogService,
    private readonly client: MetaMarketingApiClient,
    private readonly oauthState: MetaAdsOAuthStateStore,
    private readonly pendingSelection: MetaAdsPendingSelectionStore,
  ) {}

  private callbackRedirectUri(): string {
    return `${apiPublicUrl()}/meta-ads-oauth/callback`;
  }

  private settingsUrl(): string {
    return `${dashboardUrl()}/settings/meta-ads`;
  }

  private credentials(): { clientId: string; clientSecret: string } {
    const clientId = this.config.get<string>("META_OAUTH_CLIENT_ID");
    const clientSecret = this.config.get<string>("META_OAUTH_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      throw new BadRequestException("Meta Ads is not configured — META_OAUTH_CLIENT_ID/SECRET is not set.");
    }
    return { clientId, clientSecret };
  }

  /** Only an admin can start a connect (same reasoning as
   *  SocialMediaService.initiateConnect — this is a privileged, org-wide
   *  credential grant, not a per-user preference). Enforced at the
   *  controller with @Roles(ADMIN); re-checked at the callback below since
   *  the admin session could be revoked while the browser is off on Meta's
   *  consent screen. */
  initiateConnect(user: JwtClaims): { url: string } {
    const { clientId } = this.credentials();
    const state = this.oauthState.create({ orgId: user.orgId, userId: user.sub });
    const url = this.client.getOAuthUrl(clientId, state, this.callbackRedirectUri());
    return { url };
  }

  /** Called from the public OAuth callback controller — returns a frontend
   *  URL to redirect the browser to, success or failure, same contract as
   *  SocialMediaService.handleOAuthCallback. */
  async handleOAuthCallback(code: string | undefined, state: string | undefined): Promise<string> {
    const settingsUrl = this.settingsUrl();
    if (!code || !state) {
      return `${settingsUrl}?meta_ads_error=${encodeURIComponent("Missing code/state from Meta")}`;
    }

    const pending = this.oauthState.consume(state);
    if (!pending) {
      return `${settingsUrl}?meta_ads_error=${encodeURIComponent("This connection request expired or is invalid — please try again")}`;
    }

    const connectingUser = await this.prisma.user.findFirst({ where: { id: pending.userId, orgId: pending.orgId } });
    if (!connectingUser?.active || connectingUser.role !== Role.ADMIN) {
      return `${settingsUrl}?meta_ads_error=${encodeURIComponent("Your admin session is no longer valid for this action — please sign in again and retry.")}`;
    }

    try {
      const { clientId, clientSecret } = this.credentials();
      const shortLived = await this.client.exchangeCodeForToken(clientId, clientSecret, code, this.callbackRedirectUri());
      const longLived = await this.client.exchangeForLongLivedToken(clientId, clientSecret, shortLived.accessToken);
      const accounts = await this.client.listAdAccounts(longLived.accessToken);

      if (accounts.length === 0) {
        return `${settingsUrl}?meta_ads_error=${encodeURIComponent("No ad account was found for this Meta login — make sure you're an admin on at least one ad account.")}`;
      }

      const tokenExpiresAt = longLived.expiresInSec ? new Date(Date.now() + longLived.expiresInSec * 1000) : undefined;
      const pendingId = this.pendingSelection.create({
        orgId: pending.orgId,
        userId: pending.userId,
        accessToken: longLived.accessToken,
        tokenExpiresAt,
        accounts,
      });
      return `${settingsUrl}?meta_ads_pending=${pendingId}`;
    } catch (err) {
      this.logger.warn(`Meta Ads OAuth callback failed: ${(err as Error).message}`);
      return `${settingsUrl}?meta_ads_error=${encodeURIComponent((err as Error).message.slice(0, 300))}`;
    }
  }

  /** The picker's list — the access token never leaves the backend, the UI
   *  only needs enough to render checkboxes and let the operator pick. */
  getPendingSelection(user: JwtClaims, pendingId: string) {
    const pending = this.pendingSelection.get(pendingId);
    if (!pending || pending.orgId !== user.orgId) throw new NotFoundException("This selection has expired — please reconnect.");
    return {
      accounts: pending.accounts.map((a) => ({
        externalAccountId: a.id,
        name: a.name,
        currency: a.currency,
        timezoneName: a.timezone_name,
        businessName: a.business?.name,
      })),
    };
  }

  /** Connects every ad account the operator checked in one call — same
   *  "don't make them redo OAuth per account" reasoning as social-media's
   *  multi-Page picker, extended to actually allowing more than one
   *  selection at once here since an org routinely runs several ad accounts
   *  under one Business Manager. */
  async selectAdAccounts(user: JwtClaims, dto: SelectMetaAdAccountsDto) {
    if (user.role !== Role.ADMIN) throw new ForbiddenException("Only an admin can connect a Meta Ads account.");
    const pending = this.pendingSelection.get(dto.pendingId);
    if (!pending || pending.orgId !== user.orgId) throw new NotFoundException("This selection has expired — please reconnect.");

    const chosen = pending.accounts.filter((a) => dto.externalAccountIds.includes(a.id));
    if (chosen.length === 0) throw new BadRequestException("No ad account selected.");

    const accessTokenEnc = this.encryption.encrypt(pending.accessToken);
    const connected = [];
    for (const acct of chosen) {
      const row = await this.prisma.metaAdAccount.upsert({
        where: { orgId_externalAccountId: { orgId: pending.orgId, externalAccountId: acct.id } },
        create: {
          orgId: pending.orgId,
          externalAccountId: acct.id,
          name: acct.name,
          currency: acct.currency,
          timezoneName: acct.timezone_name,
          businessId: acct.business?.id,
          businessName: acct.business?.name,
          status: "CONNECTED",
          accessTokenEnc,
          tokenExpiresAt: pending.tokenExpiresAt,
          connectedByUserId: pending.userId,
          connectedAt: new Date(),
          lastSyncError: null,
        },
        update: {
          name: acct.name,
          currency: acct.currency,
          timezoneName: acct.timezone_name,
          businessId: acct.business?.id,
          businessName: acct.business?.name,
          status: "CONNECTED",
          accessTokenEnc,
          tokenExpiresAt: pending.tokenExpiresAt,
          connectedByUserId: pending.userId,
          connectedAt: new Date(),
          lastSyncError: null,
        },
      });
      connected.push(row);
    }

    await this.notifications.notify(pending.orgId, {
      category: "OTHER",
      type: "META_ADS_ACCOUNT_CONNECTED",
      severity: "WARNING",
      title: "Meta Ads Account Connected",
      message: `${connected.length} Meta ad account(s) connected: ${connected.map((c) => c.name).join(", ")}.`,
      entityType: "metaAdAccount",
      entityId: connected[0].id,
      actionUrl: "/settings/meta-ads",
    });
    this.auditLog.write({
      orgId: pending.orgId, actorId: pending.userId, action: "META_ADS_ACCOUNT_CONNECTED",
      entityType: "metaAdAccount", entityId: connected[0].id, metadata: { count: connected.length, names: connected.map((c) => c.name) },
    });

    return { connected: connected.map((c) => ({ id: c.id, name: c.name })) };
  }

  async listAccounts(orgId: string) {
    return this.prisma.metaAdAccount.findMany({
      where: { orgId },
      select: {
        id: true,
        externalAccountId: true,
        name: true,
        currency: true,
        timezoneName: true,
        businessName: true,
        status: true,
        connectedAt: true,
        lastSyncAt: true,
        lastSyncError: true,
        tokenExpiresAt: true,
      },
      orderBy: { connectedAt: "desc" },
    });
  }

  async getOwnedAccount(orgId: string, accountId: string) {
    const account = await this.prisma.metaAdAccount.findFirst({ where: { id: accountId, orgId } });
    if (!account) throw new NotFoundException("Meta ad account not found");
    return account;
  }

  async disconnectAccount(user: JwtClaims, accountId: string) {
    if (user.role !== Role.ADMIN) throw new ForbiddenException("Only an admin can disconnect a Meta Ads account.");
    const account = await this.getOwnedAccount(user.orgId, accountId);
    await this.prisma.metaAdAccount.update({
      where: { id: account.id },
      data: { status: "DISCONNECTED", accessTokenEnc: null, tokenExpiresAt: null },
    });
    return { disconnected: true };
  }
}
