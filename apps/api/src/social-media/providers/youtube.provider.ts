import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SocialAccount } from "@prisma/client";
import { google } from "googleapis";
import { Readable } from "stream";
import { EncryptionService } from "../../common/crypto/encryption.service";
import { PrismaService } from "../../common/prisma/prisma.service";
import {
  AccountInsights,
  ConnectedAccountProfile,
  Conversation,
  ConversationMessage,
  EngagementComment,
  FeedItem,
  OAuthCredentials,
  PlatformCapabilityUnavailableError,
  PlatformNotConfiguredError,
  PublishInput,
  PublishResult,
  SocialPlatformCapabilities,
  SocialPlatformProvider,
} from "./social-platform-provider.interface";
import { resolveOAuthCredentials } from "./oauth-credentials.util";

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
    likes: false,
    mediaTypes: ["video"],
    notes:
      "Google's default daily quota allows roughly 6 video uploads/day (videos.insert costs 1600 of a 10,000-unit " +
      "default quota) — raising this requires a quota-increase request to Google, not just API configuration. " +
      "Analytics require the separate YouTube Analytics API scope on top of upload access.",
  };

  constructor(
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
    private readonly prisma: PrismaService,
  ) {}

  /** Every call site below builds a fresh OAuth2 client from this rather
   *  than the top-level getOAuthUrl/exchangeCodeForToken/refreshAccessToken
   *  trio alone (Part: per-account OAuth app credentials, 2026-09-07) --
   *  unlike the other providers, YouTube's googleapis client needs its own
   *  client id/secret on every authenticated call, not just at the OAuth
   *  handshake, so `credentials` is threaded through here instead of only
   *  the three interface methods. */
  private oauthClient(redirectUri?: string, credentials?: OAuthCredentials) {
    const { clientId, clientSecret } = resolveOAuthCredentials(credentials, this.config, "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET");
    if (!clientId || !clientSecret) throw new PlatformNotConfiguredError("YouTube", "GOOGLE_OAUTH_CLIENT_ID/SECRET is not set");
    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  }

  /** Same reasoning as InstagramProvider.resolveCredentialsForAccount --
   *  resolves the account's own oauthAppId to its SocialOAuthApp credentials,
   *  falling back to undefined (env default) when unset. */
  private async resolveCredentialsForAccount(account: SocialAccount): Promise<OAuthCredentials | undefined> {
    if (!account.oauthAppId) return undefined;
    const app = await this.prisma.socialOAuthApp.findUnique({ where: { id: account.oauthAppId } });
    if (!app) return undefined;
    return { clientId: app.clientId, clientSecret: this.encryption.decrypt(app.clientSecretEnc) };
  }

  getOAuthUrl(state: string, redirectUri: string, credentials?: OAuthCredentials): string {
    const client = this.oauthClient(undefined, credentials);
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

  async exchangeCodeForToken(code: string, redirectUri: string, _codeVerifier?: string, credentials?: OAuthCredentials): Promise<ConnectedAccountProfile[]> {
    const client = this.oauthClient(redirectUri, credentials);
    const { tokens } = await client.getToken(code);
    if (!tokens.access_token) throw new Error("YouTube token exchange returned no access_token");
    client.setCredentials(tokens);

    const youtube = google.youtube({ version: "v3", auth: client });
    const channelRes = await youtube.channels.list({ part: ["snippet"], mine: true });
    const channel = channelRes.data.items?.[0];
    if (!channel?.id) throw new Error("No YouTube channel found for this Google account.");

    return [{
      externalAccountId: channel.id,
      username: channel.snippet?.title ?? channel.id,
      profileImageUrl: channel.snippet?.thumbnails?.default?.url ?? undefined,
      accountType: "channel",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? undefined,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
    }];
  }

  async refreshAccessToken(account: SocialAccount, credentials?: OAuthCredentials): Promise<{ accessToken: string; expiresAt?: Date }> {
    if (!account.refreshTokenEnc) throw new PlatformNotConfiguredError("YouTube", "no stored refresh token");
    const client = this.oauthClient(undefined, credentials);
    client.setCredentials({ refresh_token: this.encryption.decrypt(account.refreshTokenEnc) });
    const { credentials: refreshed } = await client.refreshAccessToken();
    if (!refreshed.access_token) throw new Error("YouTube token refresh returned no access_token");
    return { accessToken: refreshed.access_token, expiresAt: refreshed.expiry_date ? new Date(refreshed.expiry_date) : undefined };
  }

  async publish(account: SocialAccount, input: PublishInput): Promise<PublishResult> {
    if (!account.refreshTokenEnc) {
      throw new PlatformNotConfiguredError("YouTube", `account ${account.username} has no stored connection`);
    }
    if (!input.mediaUrls[0]) throw new Error("YouTube requires a video — no media attached to this post version");

    const client = this.oauthClient(undefined, await this.resolveCredentialsForAccount(account));
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

  /** `channels.list({part:["statistics"]})` is the Data API's own channel
   *  stats, not the separate YouTube Analytics API this provider also
   *  requests yt-analytics.readonly for — simpler and sufficient for
   *  account-level totals; per-video/date-range breakdowns would need the
   *  Analytics API proper and aren't implemented in this version. `viewCount`
   *  is a lifetime total, not a per-period reach/impressions figure, but
   *  it's the closest honest equivalent this endpoint actually returns. */
  async getAccountInsights(account: SocialAccount): Promise<AccountInsights> {
    if (!account.refreshTokenEnc) throw new PlatformNotConfiguredError("YouTube", "no stored refresh token");
    const client = this.oauthClient(undefined, await this.resolveCredentialsForAccount(account));
    client.setCredentials({ refresh_token: this.encryption.decrypt(account.refreshTokenEnc) });
    const youtube = google.youtube({ version: "v3", auth: client });
    const res = await youtube.channels.list({ part: ["statistics"], mine: true });
    const stats = res.data.items?.[0]?.statistics;
    return {
      followerCount: stats?.subscriberCount ? Number(stats.subscriberCount) : undefined,
      postsCount: stats?.videoCount ? Number(stats.videoCount) : undefined,
      impressions: stats?.viewCount ? Number(stats.viewCount) : undefined,
    };
  }

  /** `allThreadsRelatedToChannelId` gets every top-level comment across the
   *  whole channel's videos in one call, rather than listing videos first
   *  and paging commentThreads per video -- covered by the already-granted
   *  youtube.readonly scope, unlike replyToComment below. */
  async listComments(account: SocialAccount): Promise<EngagementComment[]> {
    if (!account.refreshTokenEnc) throw new PlatformNotConfiguredError("YouTube", "no stored refresh token");
    const client = this.oauthClient(undefined, await this.resolveCredentialsForAccount(account));
    client.setCredentials({ refresh_token: this.encryption.decrypt(account.refreshTokenEnc) });
    const youtube = google.youtube({ version: "v3", auth: client });
    const res = await youtube.commentThreads.list({
      part: ["snippet"],
      allThreadsRelatedToChannelId: account.externalAccountId ?? undefined,
      maxResults: 50,
    });
    return (res.data.items ?? []).flatMap((thread) => {
      const top = thread.snippet?.topLevelComment?.snippet;
      if (!top) return [];
      return [{
        externalCommentId: thread.snippet?.topLevelComment?.id ?? "",
        externalPostId: thread.snippet?.videoId ?? "",
        authorExternalId: top.authorChannelId?.value ?? undefined,
        authorName: top.authorDisplayName ?? undefined,
        authorProfileImageUrl: top.authorProfileImageUrl ?? undefined,
        text: top.textDisplay ?? undefined,
        postedAt: new Date(top.publishedAt ?? Date.now()),
        fromUs: top.authorChannelId?.value === account.externalAccountId,
      }];
    });
  }

  /** comments.insert needs the youtube.force-ssl scope, not requested in
   *  getOAuthUrl above (youtube.upload/youtube.readonly/yt-analytics.readonly
   *  don't cover writing a comment) -- same "don't guess at an unverified
   *  scope" caution as facebook.provider.ts/instagram.provider.ts's
   *  identical situation, compounded here by Google's own app-verification
   *  review for any new sensitive scope. Will throw a real Google
   *  permissions error until that's added and accounts reconnect. */
  async replyToComment(account: SocialAccount, externalCommentId: string, text: string): Promise<{ externalCommentId: string }> {
    if (!account.refreshTokenEnc) throw new PlatformNotConfiguredError("YouTube", "no stored refresh token");
    const client = this.oauthClient(undefined, await this.resolveCredentialsForAccount(account));
    client.setCredentials({ refresh_token: this.encryption.decrypt(account.refreshTokenEnc) });
    const youtube = google.youtube({ version: "v3", auth: client });
    const res = await youtube.comments.insert({
      part: ["snippet"],
      requestBody: { snippet: { parentId: externalCommentId, textOriginal: text } },
    });
    if (!res.data.id) throw new Error("YouTube comment reply did not return a comment id");
    return { externalCommentId: res.data.id };
  }

  /** Standard efficient pattern for "this channel's own videos" -- resolve
   *  the uploads playlist id once (1 quota unit), page its items (1 unit),
   *  then batch-fetch stats for every video in a single videos.list call
   *  (1 unit for up to 50 ids) rather than N individual lookups. Far
   *  cheaper than search.list({forMine:true}), which costs 100 units per
   *  call against the same 10,000-unit default daily quota
   *  publish()'s docblock already flags as tight. */
  async listFeed(account: SocialAccount): Promise<FeedItem[]> {
    if (!account.refreshTokenEnc) throw new PlatformNotConfiguredError("YouTube", "no stored refresh token");
    const client = this.oauthClient(undefined, await this.resolveCredentialsForAccount(account));
    client.setCredentials({ refresh_token: this.encryption.decrypt(account.refreshTokenEnc) });
    const youtube = google.youtube({ version: "v3", auth: client });

    const channelRes = await youtube.channels.list({ part: ["contentDetails"], mine: true });
    const uploadsPlaylistId = channelRes.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) return [];

    const itemsRes = await youtube.playlistItems.list({ part: ["snippet"], playlistId: uploadsPlaylistId, maxResults: 25 });
    const videoIds = (itemsRes.data.items ?? []).map((i) => i.snippet?.resourceId?.videoId).filter((id): id is string => !!id);
    if (videoIds.length === 0) return [];

    const videosRes = await youtube.videos.list({ part: ["snippet", "statistics"], id: videoIds });
    return (videosRes.data.items ?? []).map((v) => ({
      externalPostId: v.id!,
      content: v.snippet?.title ?? "",
      mediaUrl: v.snippet?.thumbnails?.medium?.url ?? undefined,
      permalink: `https://www.youtube.com/watch?v=${v.id}`,
      postedAt: new Date(v.snippet?.publishedAt ?? Date.now()),
      likeCount: v.statistics?.likeCount ? Number(v.statistics.likeCount) : 0,
      commentCount: v.statistics?.commentCount ? Number(v.statistics.commentCount) : 0,
    }));
  }

  async listConversations(): Promise<Conversation[]> {
    throw new PlatformCapabilityUnavailableError("YouTube", "YouTube has no direct-message concept for channels");
  }

  async listMessages(): Promise<ConversationMessage[]> {
    throw new PlatformCapabilityUnavailableError("YouTube", "YouTube has no direct-message concept for channels");
  }

  async sendMessage(): Promise<void> {
    throw new PlatformCapabilityUnavailableError("YouTube", "YouTube has no direct-message concept for channels");
  }
}
