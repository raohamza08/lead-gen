import { Module } from "@nestjs/common";
import { MetaAdsController } from "./meta-ads.controller";
import { MetaAdsOAuthCallbackController } from "./meta-ads-oauth-callback.controller";
import { MetaAdsService } from "./meta-ads.service";
import { MetaAdsSyncService } from "./meta-ads-sync.service";
import { MetaAdsAnalyticsService } from "./meta-ads-analytics.service";
import { MetaMarketingApiClient } from "./meta-marketing-api.client";
import { MetaAdsOAuthStateStore } from "./meta-ads-oauth-state.store";
import { MetaAdsPendingSelectionStore } from "./meta-ads-pending-selection.store";
import { MetaAdsSyncQueue } from "./meta-ads-sync.queue";
import { MetaAdsSyncWorker } from "./meta-ads-sync.worker";
import { MetaAdsTokenRefreshQueue } from "./meta-ads-token-refresh.queue";
import { MetaAdsTokenRefreshWorker } from "./meta-ads-token-refresh.worker";

@Module({
  controllers: [MetaAdsController, MetaAdsOAuthCallbackController],
  providers: [
    MetaAdsService,
    MetaAdsSyncService,
    MetaAdsAnalyticsService,
    MetaMarketingApiClient,
    MetaAdsOAuthStateStore,
    MetaAdsPendingSelectionStore,
    MetaAdsSyncQueue,
    MetaAdsSyncWorker,
    MetaAdsTokenRefreshQueue,
    MetaAdsTokenRefreshWorker,
  ],
})
export class MetaAdsModule {}
