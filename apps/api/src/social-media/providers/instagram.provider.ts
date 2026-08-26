import { Injectable, Logger } from "@nestjs/common";
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
 * Instagram publishing goes through the Instagram Graph API, reached via a
 * Meta (Facebook) Login OAuth app — there is no separate "Instagram OAuth."
 * The connected account must be an Instagram Business or Creator account
 * linked to a Facebook Page; a personal Instagram account cannot be
 * managed via this API at all (Part: Platform API Limitations).
 *
 * `META_GRAPH_API_VERSION` is a config var, not hardcoded, because Meta
 * retires Graph API versions on a rolling schedule — the endpoint version
 * this was written against should be re-checked at connect time, not
 * trusted to still be current by default.
 */
@Injectable()
export class InstagramProvider implements SocialPlatformProvider {
  readonly platform = "INSTAGRAM";
  private readonly logger = new Logger(InstagramProvider.name);

  readonly capabilities: SocialPlatformCapabilities = {
    publish: true,
    nativeScheduling: false,
    analytics: true,
    comments: true,
    dms: true,
    mediaTypes: ["image", "video", "carousel", "reel"],
    notes:
      "Requires a Business/Creator Instagram account linked to a Facebook Page, connected through a Meta Developer app. " +
      "Accounts added as testers on that app work with no formal review; publishing to accounts outside the app's " +
      "tester/admin list requires Meta App Review for the instagram_content_publish permission. Stories are not " +
      "supported by this integration. Feed and DMs need the account reconnected after this was added, since " +
      "instagram_manage_messages wasn't part of the original OAuth grant.",
  };

  constructor(
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
  ) {}

  private graphVersion(): string {
    return this.config.get<string>("META_GRAPH_API_VERSION", "v21.0");
  }

  private clientId(): string | undefined {
    return this.config.get<string>("META_OAUTH_CLIENT_ID");
  }

  private clientSecret(): string | undefined {
    return this.config.get<string>("META_OAUTH_CLIENT_SECRET");
  }

  getOAuthUrl(state: string, redirectUri: string): string {
    const clientId = this.clientId();
    if (!clientId) throw new PlatformNotConfiguredError("Instagram", "META_OAUTH_CLIENT_ID is not set");
    const scopes = [
      "instagram_basic",
      "instagram_content_publish",
      "instagram_manage_messages",
      "pages_show_list",
      "pages_read_engagement",
    ];
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope: scopes.join(","),
      response_type: "code",
    });
    return `https://www.facebook.com/${this.graphVersion()}/dialog/oauth?${params.toString()}`;
  }

  async exchangeCodeForToken(code: string, redirectUri: string): Promise<ConnectedAccountProfile[]> {
    const clientId = this.clientId();
    const clientSecret = this.clientSecret();
    if (!clientId || !clientSecret) {
      throw new PlatformNotConfiguredError("Instagram", "META_OAUTH_CLIENT_ID/SECRET is not set");
    }

    const tokenParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    });
    const tokenRes = await fetch(
      `https://graph.facebook.com/${this.graphVersion()}/oauth/access_token?${tokenParams.toString()}`,
    );
    if (!tokenRes.ok) {
      throw new Error(`Instagram token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
    }
    const { access_token: accessToken } = (await tokenRes.json()) as { access_token: string };

    // The Instagram *business* account id is one hop away from the token:
    // list the Pages this token can manage, then read each Page's linked
    // Instagram Business Account. Real accounts can have zero or one linked
    // IG account per Page — every Page with one comes back, not just the
    // first (Part: multi-account OAuth picker), since a Business Manager
    // admin can see several at once.
    const pagesRes = await fetch(
      `https://graph.facebook.com/${this.graphVersion()}/me/accounts?fields=id,name,instagram_business_account{id,username,profile_picture_url}&access_token=${accessToken}`,
    );
    const pages = (await pagesRes.json()) as {
      data: { instagram_business_account?: { id: string; username: string; profile_picture_url?: string } }[];
    };
    const igAccounts = pages.data?.flatMap((p) => (p.instagram_business_account ? [p.instagram_business_account] : [])) ?? [];
    if (igAccounts.length === 0) {
      throw new Error(
        "No Instagram Business/Creator account found linked to any Facebook Page this token can manage.",
      );
    }

    return igAccounts.map((igAccount) => ({
      externalAccountId: igAccount.id,
      username: `@${igAccount.username}`,
      profileImageUrl: igAccount.profile_picture_url,
      accountType: "business",
      accessToken,
    }));
  }

  async refreshAccessToken(account: SocialAccount): Promise<{ accessToken: string; expiresAt?: Date }> {
    // Meta long-lived Page/user tokens are refreshed by exchanging the
    // current token for a new long-lived one, not via a refresh_token grant.
    const clientId = this.clientId();
    const clientSecret = this.clientSecret();
    if (!clientId || !clientSecret || !account.accessTokenEnc) {
      throw new PlatformNotConfiguredError("Instagram", "no stored access token to refresh");
    }
    const current = this.encryption.decrypt(account.accessTokenEnc);
    const params = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: clientId,
      client_secret: clientSecret,
      fb_exchange_token: current,
    });
    const res = await fetch(`https://graph.facebook.com/${this.graphVersion()}/oauth/access_token?${params}`);
    if (!res.ok) throw new Error(`Instagram token refresh failed: ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in?: number };
    return {
      accessToken: body.access_token,
      expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : undefined,
    };
  }

  async publish(account: SocialAccount, input: PublishInput): Promise<PublishResult> {
    if (!account.accessTokenEnc || !account.externalAccountId) {
      throw new PlatformNotConfiguredError("Instagram", `account ${account.username} has no stored connection`);
    }
    const accessToken = this.encryption.decrypt(account.accessTokenEnc);
    const caption = [input.content, ...input.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`))].join("\n\n");

    // Two-step publish: create a media container, then publish it.
    const containerRes = await fetch(
      `https://graph.facebook.com/${this.graphVersion()}/${account.externalAccountId}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: input.mediaUrls[0],
          caption,
          access_token: accessToken,
        }),
      },
    );
    if (!containerRes.ok) {
      throw new Error(`Instagram media container failed: ${containerRes.status} ${await containerRes.text()}`);
    }
    const { id: creationId } = (await containerRes.json()) as { id: string };

    const publishRes = await fetch(
      `https://graph.facebook.com/${this.graphVersion()}/${account.externalAccountId}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creation_id: creationId, access_token: accessToken }),
      },
    );
    if (!publishRes.ok) {
      throw new Error(`Instagram publish failed: ${publishRes.status} ${await publishRes.text()}`);
    }
    const { id: mediaId } = (await publishRes.json()) as { id: string };
    return { externalPostId: mediaId };
  }

  async listFeed(account: SocialAccount): Promise<FeedItem[]> {
    if (!account.accessTokenEnc || !account.externalAccountId) {
      throw new PlatformNotConfiguredError("Instagram", `account ${account.username} has no stored connection`);
    }
    const accessToken = this.encryption.decrypt(account.accessTokenEnc);
    const res = await fetch(
      `https://graph.facebook.com/${this.graphVersion()}/${account.externalAccountId}/media` +
        `?fields=id,caption,timestamp,permalink,media_url,like_count,comments_count&access_token=${accessToken}`,
    );
    if (!res.ok) throw new Error(`Instagram feed fetch failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as {
      data: {
        id: string;
        caption?: string;
        timestamp: string;
        permalink?: string;
        media_url?: string;
        like_count?: number;
        comments_count?: number;
      }[];
    };
    return (body.data ?? []).map((p) => ({
      externalPostId: p.id,
      content: p.caption ?? "",
      mediaUrl: p.media_url,
      permalink: p.permalink,
      postedAt: new Date(p.timestamp),
      likeCount: p.like_count ?? 0,
      commentCount: p.comments_count ?? 0,
    }));
  }

  async listConversations(account: SocialAccount): Promise<Conversation[]> {
    if (!account.accessTokenEnc || !account.externalAccountId) {
      throw new PlatformNotConfiguredError("Instagram", `account ${account.username} has no stored connection`);
    }
    const accessToken = this.encryption.decrypt(account.accessTokenEnc);
    const res = await fetch(
      `https://graph.facebook.com/${this.graphVersion()}/${account.externalAccountId}/conversations` +
        `?platform=instagram&fields=participants,updated_time,snippet,unread_count&access_token=${accessToken}`,
    );
    if (!res.ok) throw new Error(`Instagram conversations fetch failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as {
      data: {
        id: string;
        participants?: { data: { id: string; username?: string }[] };
        updated_time: string;
        snippet?: string;
        unread_count?: number;
      }[];
    };
    return (body.data ?? []).map((c) => {
      const other = c.participants?.data?.find((p) => p.id !== account.externalAccountId);
      return {
        externalConversationId: c.id,
        participantExternalId: other?.id ?? "",
        participantName: other?.username ?? "Unknown",
        lastMessageSnippet: c.snippet,
        lastMessageAt: new Date(c.updated_time),
        unread: (c.unread_count ?? 0) > 0,
      };
    });
  }

  async listMessages(account: SocialAccount, conversationId: string): Promise<ConversationMessage[]> {
    if (!account.accessTokenEnc) throw new PlatformNotConfiguredError("Instagram", `account ${account.username} has no stored connection`);
    const accessToken = this.encryption.decrypt(account.accessTokenEnc);
    const res = await fetch(
      `https://graph.facebook.com/${this.graphVersion()}/${conversationId}/messages` +
        `?fields=id,message,from,created_time&access_token=${accessToken}`,
    );
    if (!res.ok) throw new Error(`Instagram messages fetch failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as {
      data: { id: string; message?: string; from?: { id: string; username?: string }; created_time: string }[];
    };
    return (body.data ?? [])
      .map((m) => ({
        externalMessageId: m.id,
        fromUs: m.from?.id === account.externalAccountId,
        senderName: m.from?.username ?? "Unknown",
        text: m.message ?? "",
        sentAt: new Date(m.created_time),
      }))
      .reverse();
  }

  async sendMessage(account: SocialAccount, participantId: string, text: string): Promise<void> {
    if (!account.accessTokenEnc || !account.externalAccountId) {
      throw new PlatformNotConfiguredError("Instagram", `account ${account.username} has no stored connection`);
    }
    const accessToken = this.encryption.decrypt(account.accessTokenEnc);
    const res = await fetch(`https://graph.facebook.com/${this.graphVersion()}/${account.externalAccountId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: participantId }, message: { text }, access_token: accessToken }),
    });
    if (!res.ok) throw new Error(`Instagram send message failed: ${res.status} ${await res.text()}`);
  }
}
