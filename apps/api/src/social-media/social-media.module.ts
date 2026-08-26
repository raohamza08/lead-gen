import { Module } from "@nestjs/common";
import { InstagramProvider } from "./providers/instagram.provider";
import { FacebookProvider } from "./providers/facebook.provider";
import { LinkedInProvider } from "./providers/linkedin.provider";
import { XProvider } from "./providers/x.provider";
import { TikTokProvider } from "./providers/tiktok.provider";
import { YouTubeProvider } from "./providers/youtube.provider";
import { SocialProviderRegistryService } from "./providers/social-provider-registry.service";
import { LocalDiskMediaStorageService } from "./media/local-disk-media-storage.service";
import { MEDIA_STORAGE_SERVICE } from "./media/media-storage.interface";
import { MediaFileController } from "./media/media-file.controller";
import { OAuthStateStore } from "./oauth-state.store";
import { PendingAccountSelectionStore } from "./pending-account-selection.store";
import { SocialPublishQueue } from "./social-publish.queue";
import { SocialPublishWorker } from "./social-publish.worker";
import { SocialMediaService } from "./social-media.service";
import { SocialMediaController } from "./social-media.controller";
import { SocialMediaSettingsController } from "./social-media-settings.controller";
import { SocialOAuthCallbackController } from "./social-oauth-callback.controller";

@Module({
  controllers: [SocialMediaController, SocialMediaSettingsController, SocialOAuthCallbackController, MediaFileController],
  providers: [
    InstagramProvider,
    FacebookProvider,
    LinkedInProvider,
    XProvider,
    TikTokProvider,
    YouTubeProvider,
    SocialProviderRegistryService,
    { provide: MEDIA_STORAGE_SERVICE, useClass: LocalDiskMediaStorageService },
    OAuthStateStore,
    PendingAccountSelectionStore,
    SocialPublishQueue,
    SocialPublishWorker,
    SocialMediaService,
  ],
  exports: [SocialMediaService],
})
export class SocialMediaModule {}
