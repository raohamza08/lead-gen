import { Injectable } from "@nestjs/common";
import { SocialPlatform } from "@prisma/client";
import { SocialPlatformProvider } from "./social-platform-provider.interface";
import { InstagramProvider } from "./instagram.provider";
import { FacebookProvider } from "./facebook.provider";
import { LinkedInProvider } from "./linkedin.provider";
import { XProvider } from "./x.provider";
import { TikTokProvider } from "./tiktok.provider";
import { YouTubeProvider } from "./youtube.provider";
import { WhatsAppProvider } from "./whatsapp.provider";

/**
 * Resolves a SocialPlatform enum value to its provider instance — the single
 * lookup point SocialMediaService and the publish worker use instead of a
 * switch statement scattered across the codebase (mirrors EmailProviderService's
 * providerFor, one level more generic since there are six platforms here, not two).
 * Also the one place the UI-facing capability registry is assembled from, so
 * "what can platform X do" always reflects what its provider actually declares.
 */
@Injectable()
export class SocialProviderRegistryService {
  private readonly providers: Record<SocialPlatform, SocialPlatformProvider>;

  constructor(
    instagram: InstagramProvider,
    facebook: FacebookProvider,
    linkedin: LinkedInProvider,
    x: XProvider,
    tiktok: TikTokProvider,
    youtube: YouTubeProvider,
    whatsapp: WhatsAppProvider,
  ) {
    this.providers = {
      INSTAGRAM: instagram,
      FACEBOOK: facebook,
      LINKEDIN: linkedin,
      X: x,
      TIKTOK: tiktok,
      YOUTUBE: youtube,
      WHATSAPP: whatsapp,
    };
  }

  for(platform: SocialPlatform): SocialPlatformProvider {
    return this.providers[platform];
  }

  /** Full capability registry, keyed by platform — what the Accounts/Composer UI reads to grey out unsupported actions per platform. */
  capabilityRegistry(): Record<SocialPlatform, SocialPlatformProvider["capabilities"]> {
    return Object.fromEntries(
      Object.entries(this.providers).map(([platform, provider]) => [platform, provider.capabilities]),
    ) as Record<SocialPlatform, SocialPlatformProvider["capabilities"]>;
  }
}
