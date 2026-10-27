import { Module } from "@nestjs/common";
import { InstagramProvider } from "./providers/instagram.provider";
import { FacebookProvider } from "./providers/facebook.provider";
import { LinkedInProvider } from "./providers/linkedin.provider";
import { XProvider } from "./providers/x.provider";
import { TikTokProvider } from "./providers/tiktok.provider";
import { YouTubeProvider } from "./providers/youtube.provider";
import { WhatsAppProvider } from "./providers/whatsapp.provider";
import { WhatsAppQrProvider } from "./providers/whatsapp-qr.provider";
import { SocialProviderRegistryService } from "./providers/social-provider-registry.service";
import { WhatsAppQrSessionManagerService } from "./whatsapp-qr/whatsapp-qr-session-manager.service";
import { WhatsAppQrReconnectQueue } from "./whatsapp-qr/whatsapp-qr-reconnect.queue";
import { WhatsAppQrReconnectWorker } from "./whatsapp-qr/whatsapp-qr-reconnect.worker";
import { WhatsAppQrController } from "./whatsapp-qr/whatsapp-qr.controller";
import { LocalDiskMediaStorageService } from "./media/local-disk-media-storage.service";
import { MEDIA_STORAGE_SERVICE } from "./media/media-storage.interface";
import { MediaFileController } from "./media/media-file.controller";
import { OAuthStateStore } from "./oauth-state.store";
import { PendingAccountSelectionStore } from "./pending-account-selection.store";
import { SocialPublishQueue } from "./social-publish.queue";
import { SocialPublishWorker } from "./social-publish.worker";
import { SocialTokenRefreshQueue } from "./social-token-refresh.queue";
import { SocialTokenRefreshWorker } from "./social-token-refresh.worker";
import { SocialAnalyticsSyncQueue } from "./social-analytics-sync.queue";
import { SocialAnalyticsSyncWorker } from "./social-analytics-sync.worker";
import { SocialAnalyticsService } from "./social-analytics.service";
import { SocialMediaService } from "./social-media.service";
import { SocialMediaController } from "./social-media.controller";
import { SocialMediaSettingsController } from "./social-media-settings.controller";
import { SocialOAuthCallbackController } from "./social-oauth-callback.controller";
import { SocialInboxIngestService } from "./social-inbox-ingest.service";
import { SocialInboxSyncQueue } from "./social-inbox-sync.queue";
import { SocialInboxSyncWorker } from "./social-inbox-sync.worker";
import { SocialInboxService } from "./social-inbox.service";
import { SocialInboxController } from "./social-inbox.controller";
import { SocialEngagementIngestService } from "./social-engagement-ingest.service";
import { SocialEngagementSyncWorker } from "./social-engagement-sync.worker";
import { SocialEngagementService } from "./social-engagement.service";
import { SocialEngagementController } from "./social-engagement.controller";
import { SocialOAuthAppService } from "./social-oauth-app.service";

@Module({
  controllers: [
    SocialMediaController,
    SocialMediaSettingsController,
    SocialOAuthCallbackController,
    MediaFileController,
    SocialInboxController,
    SocialEngagementController,
    WhatsAppQrController,
  ],
  providers: [
    InstagramProvider,
    FacebookProvider,
    LinkedInProvider,
    XProvider,
    TikTokProvider,
    YouTubeProvider,
    WhatsAppProvider,
    WhatsAppQrProvider,
    WhatsAppQrSessionManagerService,
    WhatsAppQrReconnectQueue,
    WhatsAppQrReconnectWorker,
    SocialProviderRegistryService,
    { provide: MEDIA_STORAGE_SERVICE, useClass: LocalDiskMediaStorageService },
    OAuthStateStore,
    PendingAccountSelectionStore,
    SocialPublishQueue,
    SocialPublishWorker,
    SocialTokenRefreshQueue,
    SocialTokenRefreshWorker,
    SocialAnalyticsSyncQueue,
    SocialAnalyticsSyncWorker,
    SocialAnalyticsService,
    SocialMediaService,
    SocialInboxIngestService,
    SocialInboxSyncQueue,
    SocialInboxSyncWorker,
    SocialInboxService,
    SocialEngagementIngestService,
    // SocialEngagementSyncQueue deliberately not registered (2026-09-30) --
    // Engagement is disconnected/hidden, no current requirement. That Queue
    // is what schedules the repeatable "tick" job (and its already-scheduled
    // job was removed from Redis directly); SocialEngagementSyncWorker
    // itself stays registered below since SocialEngagementService injects
    // it directly for manual per-account sync (bypassing the queue) -- with
    // no Queue ever adding jobs, the Worker's own consumer just sits idle,
    // so automatic polling is fully stopped either way. Re-adding the
    // Queue's import + provider line reconnects the poll cycle later.
    SocialEngagementSyncWorker,
    SocialEngagementService,
    SocialOAuthAppService,
  ],
  // SocialInboxService added (Part: global search, 2026-10-21) so
  // SearchModule/AiAssistantModule can reuse its existing listConversations
  // search query instead of duplicating it.
  // WhatsAppProvider added (Part: WhatsApp Cloud API inbound media,
  // 2026-10-27) so WebhooksModule's SocialWebhookController can call its
  // downloadInboundMedia directly for inbound image/video/document/audio
  // messages -- the webhook payload only carries a Graph API media id, and
  // WhatsAppProvider already owns the Graph API version/credentials logic
  // every other Cloud API call here goes through.
  exports: [SocialMediaService, SocialInboxIngestService, SocialProviderRegistryService, SocialInboxService, WhatsAppProvider],
})
export class SocialMediaModule {}
