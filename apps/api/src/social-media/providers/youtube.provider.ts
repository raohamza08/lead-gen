import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SocialAccount } from "@prisma/client";
import { google } from "googleapis";
import { Readable } from "stream";
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
 * YouTube Data API v3, standard Google OAuth2 — same client/credential shape
 * as the existing GmailProvider (google.auth.OAuth2), a different scope.
 * Uploads count heavily against YouTube's default daily quota (a single
 * videos.insert call costs 1600 units against a 10,000-unit default daily
 * quota — about 6 uploads/day before hitting Google's own limit, raisable
 * only via a quota-increase request). Flagged here, not assumed away.
 */
@Injectable()
export class YouTubeProvider implements SocialPlatformProvider {
  readonly platform = "YOUTUBE";

  readonly capabilities: SocialPlatformCapabilities = {
    publish: true,
    nativeScheduling: true, // YouTube's own API accepts a publishAt privacyStatus.publishAt for scheduled release
    analytics: true,
    comments: true,
    dms: false,
    mediaTypes: ["video"],
    notes:
      "Google's default daily quota allows roughly 6 video uploads/day (videos.insert costs 1600 of a 10,000-unit " +
      "default quota) — raising this requires a quota-increase request to Google, not just API configuration. " +
      "Analytics require the separate YouTube Analytics API scope on top of upload access.",
  };

  constructor(
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
  ) {}

  private oauthClient(redirectUri?: string) {
    const clientId = this.config.get<string>("GOOGLE_OAUTH_CLIENT_ID");
    const clientSecret = this.config.get<string>("GOOGLE_OAUTH_CLIENT_SECRET");
    if (!clientId || !clientSecret) throw new PlatformNotConfiguredError("YouTube", "GOOGLE_OAUTH_CLIENT_ID/SECRET is not set");
    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  }

  getOAuthUrl(state: string, redirectUri: string): string {
    const client = this.oauthClient();
    return client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent", // forces a refresh_token even on a re-consent
      redirect_uri: redirectUri,
      state,
      scope: [
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/youtube.readonly",
        "https://www.googleapis.com/auth/yt-analytics.readonly",
      ],
    });
  }

  async exchangeCodeForToken(code: string, redirectUri: string): Promise<ConnectedAccountProfile> {
    const client = this.oauthClient(redirectUri);
    const { tokens } = await client.getToken(code);
    if (!tokens.access_token) throw new Error("YouTube token exchange returned no access_token");
    client.setCredentials(tokens);

    const youtube = google.youtube({ version: "v3", auth: client });
    const channelRes = await youtube.channels.list({ part: ["snippet"], mine: true });
    const channel = channelRes.data.items?.[0];
    if (!channel?.id) throw new Error("No YouTube channel found for this Google account.");

    return {
      externalAccountId: channel.id,
      username: channel.snippet?.title ?? channel.id,
      profileImageUrl: channel.snippet?.thumbnails?.default?.url ?? undefined,
      accountType: "channel",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? undefined,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
    };
  }

  async refreshAccessToken(account: SocialAccount): Promise<{ accessToken: string; expiresAt?: Date }> {
    if (!account.refreshTokenEnc) throw new PlatformNotConfiguredError("YouTube", "no stored refresh token");
    const client = this.oauthClient();
    client.setCredentials({ refresh_token: this.encryption.decrypt(account.refreshTokenEnc) });
    const { credentials } = await client.refreshAccessToken();
    if (!credentials.access_token) throw new Error("YouTube token refresh returned no access_token");
    return { accessToken: credentials.access_token, expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : undefined };
  }

  async publish(account: SocialAccount, input: PublishInput): Promise<PublishResult> {
    if (!account.refreshTokenEnc) {
      throw new PlatformNotConfiguredError("YouTube", `account ${account.username} has no stored connection`);
    }
    if (!input.mediaUrls[0]) throw new Error("YouTube requires a video — no media attached to this post version");

    const client = this.oauthClient();
    client.setCredentials({ refresh_token: this.encryption.decrypt(account.refreshTokenEnc) });
    const youtube = google.youtube({ version: "v3", auth: client });

    const videoRes = await fetch(input.mediaUrls[0]);
    if (!videoRes.ok || !videoRes.body) throw new Error(`Could not fetch media for upload: ${videoRes.status}`);

    const [title, ...descParts] = input.content.split("\n");
    const description = [descParts.join("\n"), ...input.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`))]
      .filter(Boolean)
      .join("\n\n");

    const res = await youtube.videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: { title: title.slice(0, 100), description },
        status: { privacyStatus: "public" },
      },
      media: { body: Readable.fromWeb(videoRes.body as any) },
    });
    if (!res.data.id) throw new Error("YouTube upload did not return a video id");
    return { externalPostId: res.data.id };
  }
}
