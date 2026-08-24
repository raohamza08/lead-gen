import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SocialAccount } from "@prisma/client";
import { EncryptionService } from "../../common/crypto/encryption.service";
import {
  ConnectedAccountProfile,
  PlatformNotConfiguredError,
  PublishInput,
  PublishResult,
  SocialPlatformCapabilities,
  SocialPlatformProvider,
} from "./social-platform-provider.interface";

/**
 * TikTok's Content Posting API requires its own developer app approval,
 * and — important, don't assume otherwise — an unaudited app is generally
 * restricted to posting as a private draft the account owner must open the
 * TikTok app to finish publishing, not a true direct-to-public auto-post.
 * Full auto-publish needs TikTok's audit of the app. Marked here rather
 * than silently assumed away (Part: Platform API Limitations).
 */
@Injectable()
export class TikTokProvider implements SocialPlatformProvider {
  readonly platform = "TIKTOK";

  readonly capabilities: SocialPlatformCapabilities = {
    publish: true,
    nativeScheduling: false,
    analytics: false,
    comments: false,
    dms: false,
    mediaTypes: ["video"],
    notes:
      "Requires a TikTok developer app approved for the Content Posting API. Until that app passes TikTok's own " +
      "audit, posts typically land as a private draft in the creator's TikTok app rather than publishing directly " +
      "— true unattended auto-publish is not guaranteed without that audit. Verify current status before relying " +
      "on this for scheduled publishing.",
  };

  constructor(
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
  ) {}

  getOAuthUrl(state: string, redirectUri: string): string {
    const clientKey = this.config.get<string>("TIKTOK_CLIENT_KEY");
    if (!clientKey) throw new PlatformNotConfiguredError("TikTok", "TIKTOK_CLIENT_KEY is not set");
    const params = new URLSearchParams({
      client_key: clientKey, // TikTok's own naming — "client_key," not "client_id"
      response_type: "code",
      scope: ["user.info.basic", "video.publish"].join(","),
      redirect_uri: redirectUri,
      state,
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
  }

  async exchangeCodeForToken(code: string, redirectUri: string): Promise<ConnectedAccountProfile> {
    const clientKey = this.config.get<string>("TIKTOK_CLIENT_KEY");
    const clientSecret = this.config.get<string>("TIKTOK_CLIENT_SECRET");
    if (!clientKey || !clientSecret) throw new PlatformNotConfiguredError("TikTok", "TIKTOK_CLIENT_KEY/SECRET is not set");

    const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) throw new Error(`TikTok token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
    const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn, open_id: openId } =
      (await tokenRes.json()) as { access_token: string; refresh_token?: string; expires_in?: number; open_id: string };

    const profileRes = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=display_name,avatar_url", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const profile = (await profileRes.json()) as { data?: { user?: { display_name?: string; avatar_url?: string } } };

    return {
      externalAccountId: openId,
      username: profile.data?.user?.display_name ?? openId,
      profileImageUrl: profile.data?.user?.avatar_url,
      accountType: "creator",
      accessToken,
      refreshToken,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined,
    };
  }

  async refreshAccessToken(account: SocialAccount): Promise<{ accessToken: string; expiresAt?: Date }> {
    const clientKey = this.config.get<string>("TIKTOK_CLIENT_KEY");
    const clientSecret = this.config.get<string>("TIKTOK_CLIENT_SECRET");
    if (!clientKey || !clientSecret || !account.refreshTokenEnc) {
      throw new PlatformNotConfiguredError("TikTok", "no stored refresh token");
    }
    const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: this.encryption.decrypt(account.refreshTokenEnc),
      }),
    });
    if (!res.ok) throw new Error(`TikTok token refresh failed: ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in?: number };
    return { accessToken: body.access_token, expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : undefined };
  }

  async publish(account: SocialAccount, input: PublishInput): Promise<PublishResult> {
    if (!account.accessTokenEnc) {
      throw new PlatformNotConfiguredError("TikTok", `account ${account.username} has no stored connection`);
    }
    if (!input.mediaUrls[0]) throw new Error("TikTok requires a video — no media attached to this post version");
    const accessToken = this.encryption.decrypt(account.accessTokenEnc);

    const res = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        post_info: { title: input.content, privacy_level: "SELF_ONLY" }, // SELF_ONLY until the app passes TikTok's audit — see capabilities.notes
        source_info: { source: "PULL_FROM_URL", video_url: input.mediaUrls[0] },
      }),
    });
    if (!res.ok) throw new Error(`TikTok publish failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { data: { publish_id: string } };
    return { externalPostId: body.data.publish_id };
  }
}
