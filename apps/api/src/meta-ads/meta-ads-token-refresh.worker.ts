import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../common/prisma/prisma.service";
import { EncryptionService } from "../common/crypto/encryption.service";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";
import { MetaApiError, MetaMarketingApiClient } from "./meta-marketing-api.client";

const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // re-exchange any token expiring within a week

/** Unlike a Facebook Page token (which doesn't meaningfully expire, see
 *  facebook.provider.ts's own refreshAccessToken), a Meta Ads long-lived
 *  user token genuinely expires (~60 days) -- letting it lapse silently
 *  would turn "reporting stopped updating" into a support question days
 *  later. Proactively re-exchanges via the same fb_exchange_token grant the
 *  initial connect used, well before expiry. */
@Injectable()
export class MetaAdsTokenRefreshWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetaAdsTokenRefreshWorker.name);
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly client: MetaMarketingApiClient,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(QUEUE_NAMES.META_ADS_TOKEN_REFRESH, () => this.tick(), {
      connection: getRedisConnection(),
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`meta-ads-token-refresh tick failed: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async tick() {
    const clientId = this.config.get<string>("META_OAUTH_CLIENT_ID");
    const clientSecret = this.config.get<string>("META_OAUTH_CLIENT_SECRET");
    if (!clientId || !clientSecret) return;

    const dueAccounts = await this.prisma.metaAdAccount.findMany({
      where: { status: "CONNECTED", accessTokenEnc: { not: null }, tokenExpiresAt: { lt: new Date(Date.now() + REFRESH_WINDOW_MS) } },
    });

    for (const account of dueAccounts) {
      try {
        const currentToken = this.encryption.decrypt(account.accessTokenEnc!);
        const refreshed = await this.client.exchangeForLongLivedToken(clientId, clientSecret, currentToken);
        await this.prisma.metaAdAccount.update({
          where: { id: account.id },
          data: {
            accessTokenEnc: this.encryption.encrypt(refreshed.accessToken),
            tokenExpiresAt: refreshed.expiresInSec ? new Date(Date.now() + refreshed.expiresInSec * 1000) : null,
          },
        });
      } catch (err) {
        const isAuthError = err instanceof MetaApiError && err.isAuthError;
        this.logger.warn(`Meta Ads token refresh failed for account ${account.id}: ${(err as Error).message}`);
        if (isAuthError) {
          await this.prisma.metaAdAccount.update({
            where: { id: account.id },
            data: { status: "EXPIRED", lastSyncError: "Access token expired or was revoked — reconnect this account." },
          });
        }
      }
    }
  }
}
