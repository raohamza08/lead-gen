import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { SocialAccount, NotificationCategory } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { EncryptionService } from "../common/crypto/encryption.service";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { NotificationsService } from "../notifications/notifications.service";
import { SocialProviderRegistryService } from "./providers/social-provider-registry.service";

/** How far ahead of actual expiry an account becomes eligible for refresh
 *  (Part: Connected Social Accounts token vault, 2026-09-07) -- refreshing
 *  reactively, only after a token has already expired, means the request
 *  that discovers the expiry (a scheduled publish, a feed fetch) fails
 *  first and only recovers on the *next* attempt. A 1-hour lookahead against
 *  a 15-minute tick (SOCIAL_TOKEN_REFRESH_INTERVAL_MS) gives every account
 *  several chances to refresh well before a real caller ever hits a dead
 *  token, which is what "zero manual intervention" actually requires --
 *  reactive-only refresh would still be a human noticing and reconnecting. */
const REFRESH_LOOKAHEAD_MS = 60 * 60 * 1000;

/**
 * Consumes the repeatable "tick" job from SocialTokenRefreshQueue -- the
 * missing half of the token vault: every provider already implements
 * refreshAccessToken() (social-platform-provider.interface.ts), but nothing
 * ever called it. Without this, any platform whose token actually expires
 * (LinkedIn, TikTok, X, WhatsApp, YouTube -- Facebook/Instagram Page tokens
 * don't expire under normal use and typically have no refreshTokenEnc to
 * begin with, so the query below naturally skips them) would silently start
 * failing every action once its token lapsed, with no path back except an
 * admin manually reconnecting.
 *
 * Same "one tick walks every due row sequentially" shape as
 * SocialPublishWorker/EmailHubSyncWorker -- simpler than N independent jobs
 * at V1 scale, and one account's slow/failing refresh only delays the rest
 * of this tick by a few seconds.
 */
@Injectable()
export class SocialTokenRefreshWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SocialTokenRefreshWorker.name);
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly registry: SocialProviderRegistryService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(QUEUE_NAMES.SOCIAL_TOKEN_REFRESH, () => this.tick(), {
      connection: getRedisConnection(),
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`social-token-refresh tick failed: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async tick() {
    const due = await this.prisma.socialAccount.findMany({
      where: {
        status: "CONNECTED",
        refreshTokenEnc: { not: null },
        tokenExpiresAt: { not: null, lte: new Date(Date.now() + REFRESH_LOOKAHEAD_MS) },
      },
      take: 100,
    });

    for (const account of due) {
      try {
        await this.refreshOne(account);
      } catch (err) {
        this.logger.error(`Unexpected error refreshing ${account.platform} account ${account.id}: ${(err as Error).message}`);
      }
    }
  }

  private async refreshOne(account: SocialAccount) {
    const provider = this.registry.for(account.platform);
    let result: { accessToken: string; expiresAt?: Date };
    try {
      result = await provider.refreshAccessToken(account);
    } catch (err) {
      // A refresh failure this early (the token hasn't expired yet -- this
      // runs REFRESH_LOOKAHEAD_MS ahead of that) means the *refresh* token
      // itself is invalid or revoked (the user revoked app access on the
      // platform's side, or the platform rotated it out from under us) --
      // no amount of retrying fixes that without the admin reconnecting.
      // EXPIRED (not ERROR) is the status the accounts UI already renders
      // for exactly this "needs reconnecting" case (see
      // apps/web/app/(dashboard)/social-media/accounts/page.tsx).
      await this.prisma.socialAccount.update({ where: { id: account.id }, data: { status: "EXPIRED" } });
      await this.prisma.socialAuditLog.create({
        data: {
          orgId: account.orgId,
          action: "TOKEN_REFRESH_FAILED",
          accountId: account.id,
          diff: { platform: account.platform, error: (err as Error).message.slice(0, 500) },
        },
      });
      this.realtime.emitToOrg(account.orgId, "socialMedia.accountUpdated", { accountId: account.id, status: "EXPIRED" });
      await this.notifications.notify(account.orgId, {
        category: NotificationCategory.SOCIAL,
        type: "SOCIAL_TOKEN_REFRESH_FAILED",
        severity: "ERROR",
        title: "Social Account Needs Reconnecting",
        message: `${account.platform} account @${account.username}'s connection expired and could not be automatically renewed -- reconnect it in Settings.`,
        entityType: "socialAccount",
        entityId: account.id,
        actionUrl: "/settings/social-media",
      });
      return;
    }

    await this.prisma.socialAccount.update({
      where: { id: account.id },
      data: { accessTokenEnc: this.encryption.encrypt(result.accessToken), tokenExpiresAt: result.expiresAt ?? null },
    });
    await this.prisma.socialAuditLog.create({
      data: { orgId: account.orgId, action: "TOKEN_REFRESHED", accountId: account.id, diff: { platform: account.platform } },
    });
  }
}
