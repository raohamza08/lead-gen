import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SocialAccount } from "@prisma/client";
import { EncryptionService } from "../../common/crypto/encryption.service";
import {
  ConnectedAccountProfile,
  Conversation,
  ConversationMessage,
  FeedItem,
  PlatformNotConfiguredError,
  PublishInput,
  PublishResult,
  SocialPlatformCapabilities,
  SocialPlatformProvider,
} from "./social-platform-provider.interface";

/**
 * LinkedIn's posting API sits behind the Marketing Developer Platform for
 * Company Page publishing (`w_organization_social` — a partner-gated
 * program requiring LinkedIn's approval of the use case, not simple
 * self-serve OAuth app creation) or `w_member_social` for a personal
 * profile via the more accessible Sign In with LinkedIn product. Both use
 * the same standard OAuth2 flow below; which scope(s) actually work
 * depends entirely on what LinkedIn has approved for the connected app.
 */
@Injectable()
export class LinkedInProvider implements SocialPlatformProvider {
  readonly platform = "LINKEDIN";

  readonly capabilities: SocialPlatformCapabilities = {
    publish: true,
    nativeScheduling: false,
    analytics: false, // Organization analytics require additional Marketing Developer Platform approval beyond posting
    comments: false,
    dms: false,
    mediaTypes: ["image", "video", "article-link"],
    notes:
      "Company Page posting requires approval for LinkedIn's Marketing Developer Platform (partner-gated, apply " +
      "and wait for LinkedIn's review — not instant). Personal-profile posting via w_member_social is more " +
      "accessible but has been progressively restricted for third-party tools over time; verify current terms " +
      "before relying on it.",
  };

  constructor(
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
  ) {}

  getOAuthUrl(state: string, redirectUri: string): string {
    const clientId = this.config.get<string>("LINKEDIN_OAUTH_CLIENT_ID");
    if (!clientId) throw new PlatformNotConfiguredError("LinkedIn", "LINKEDIN_OAUTH_CLIENT_ID is not set");
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      // openid + profile are what /v2/userinfo below actually needs (Sign In
      // with LinkedIn using OpenID Connect) -- r_basicprofile was the old
      // REST-API scope for the now-unused /v2/me endpoint and doesn't grant
      // access to /v2/userinfo at all, which silently produced an empty
      // profile (no `sub`) and a confusing failure two layers downstream.
      scope: ["openid", "profile", "w_member_social", "r_organization_social", "w_organization_social"].join(" "),
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
  }

  async exchangeCodeForToken(code: string, redirectUri: string): Promise<ConnectedAccountProfile[]> {
    const clientId = this.config.get<string>("LINKEDIN_OAUTH_CLIENT_ID");
    const clientSecret = this.config.get<string>("LINKEDIN_OAUTH_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      throw new PlatformNotConfiguredError("LinkedIn", "LINKEDIN_OAUTH_CLIENT_ID/SECRET is not set");
    }
    const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!tokenRes.ok) throw new Error(`LinkedIn token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
    const { access_token: accessToken, expires_in: expiresIn } = (await tokenRes.json()) as {
      access_token: string;
      expires_in?: number;
    };

    const profileRes = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const profile = (await profileRes.json()) as { sub?: string; name?: string; picture?: string; message?: string };
    // Fail here with LinkedIn's own message, not three layers down as a
    // cryptic Prisma "missing username" error once `sub` turns out undefined.
    if (!profile.sub) {
      throw new Error(
        `LinkedIn userinfo request did not return a profile (status ${profileRes.status}): ${profile.message ?? JSON.stringify(profile)}`,
      );
    }

    return [{
      externalAccountId: profile.sub,
      username: profile.name ?? profile.sub,
      profileImageUrl: profile.picture,
      accountType: "personal",
      accessToken,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined,
    }];
  }

  async refreshAccessToken(account: SocialAccount): Promise<{ accessToken: string; expiresAt?: Date }> {
    const clientId = this.config.get<string>("LINKEDIN_OAUTH_CLIENT_ID");
    const clientSecret = this.config.get<string>("LINKEDIN_OAUTH_CLIENT_SECRET");
    if (!clientId || !clientSecret || !account.refreshTokenEnc) {
      throw new PlatformNotConfiguredError("LinkedIn", "no stored refresh token");
    }
    const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.encryption.decrypt(account.refreshTokenEnc),
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!res.ok) throw new Error(`LinkedIn token refresh failed: ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in?: number };
    return { accessToken: body.access_token, expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : undefined };
  }

  async publish(account: SocialAccount, input: PublishInput): Promise<PublishResult> {
    if (!account.accessTokenEnc || !account.externalAccountId) {
      throw new PlatformNotConfiguredError("LinkedIn", `account ${account.username} has no stored connection`);
    }
    const accessToken = this.encryption.decrypt(account.accessTokenEnc);
    const authorUrn = `urn:li:person:${account.externalAccountId}`;

    const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        author: authorUrn,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text: [input.content, ...input.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`))].join("\n\n") },
            shareMediaCategory: input.mediaUrls[0] ? "IMAGE" : "NONE",
          },
        },
        visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
      }),
    });
    if (!res.ok) throw new Error(`LinkedIn publish failed: ${res.status} ${await res.text()}`);
    const postId = res.headers.get("x-restli-id") ?? (await res.json().catch(() => ({})))?.id;
    return { externalPostId: postId ?? "unknown" };
  }

  // LinkedIn has no public third-party API for reading a feed or for
  // reading/sending messages -- unlike Meta, there is no compliant path
  // here at all, not just a permissions gate. Same reasoning this codebase
  // already applies to LinkedIn outreach elsewhere (kept human-driven).
  async listFeed(): Promise<FeedItem[]> {
    throw new PlatformNotConfiguredError("LinkedIn", "reading a feed is not available through LinkedIn's public API");
  }

  async listConversations(): Promise<Conversation[]> {
    throw new PlatformNotConfiguredError("LinkedIn", "messaging is not available through LinkedIn's public API for third-party apps");
  }

  async listMessages(): Promise<ConversationMessage[]> {
    throw new PlatformNotConfiguredError("LinkedIn", "messaging is not available through LinkedIn's public API for third-party apps");
  }

  async sendMessage(): Promise<void> {
    throw new PlatformNotConfiguredError("LinkedIn", "messaging is not available through LinkedIn's public API for third-party apps");
  }
}
