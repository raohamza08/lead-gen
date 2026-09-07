import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SocialAccount } from "@prisma/client";
import { EncryptionService } from "../../common/crypto/encryption.service";
import {
  AccountInsights,
  ConnectedAccountProfile,
  Conversation,
  ConversationMessage,
  EngagementComment,
  FeedItem,
  OAuthCredentials,
  PlatformNotConfiguredError,
  PublishInput,
  PublishResult,
  SocialPlatformCapabilities,
  SocialPlatformProvider,
} from "./social-platform-provider.interface";
import { resolveOAuthCredentials } from "./oauth-credentials.util";

/** Facebook Page publishing via the Graph API — same Meta Developer app and
 *  OAuth flow as Instagram (Part: API & Provider Architecture reuses the
 *  same app registration across both Meta-owned platforms), simpler on the
 *  Facebook side since a Page token publishes directly with no linked-
 *  account lookup step. */
@Injectable()
export class FacebookProvider implements SocialPlatformProvider {
  readonly platform = "FACEBOOK";

  readonly capabilities: SocialPlatformCapabilities = {
    publish: true,
    nativeScheduling: true, // Facebook's own Page publishing API accepts a scheduled_publish_time
    analytics: true,
    comments: true,
    dms: true,
    likes: true,
    mediaTypes: ["image", "video", "link"],
    notes:
      "Publishes to a Facebook Page (not a personal profile — the Graph API does not support posting to personal " +
      "timelines for third-party apps). Uses the same Meta Developer app as Instagram. Feed and Messenger " +
      "conversations need the account reconnected after this was added, since pages_messaging wasn't part of the " +
      "original OAuth grant.",
  };

  constructor(
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
  ) {}

  private graphVersion(): string {
    return this.config.get<string>("META_GRAPH_API_VERSION", "v21.0");
  }

  getOAuthUrl(state: string, redirectUri: string, credentials?: OAuthCredentials): string {
    const { clientId } = resolveOAuthCredentials(credentials, this.config, "META_OAUTH_CLIENT_ID", "META_OAUTH_CLIENT_SECRET");
    if (!clientId) throw new PlatformNotConfiguredError("Facebook", "META_OAUTH_CLIENT_ID is not set");
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      // pages_manage_posts dropped -- not approved for this app (Meta returns
      // "Invalid Scopes" and rejects the whole OAuth request if even one
      // requested scope isn't available, confirmed 2026-08-27).
      // pages_manage_metadata is what /subscribed_apps (webhook subscription)
      // actually needs and is available, so requested instead.
      //
      // pages_read_engagement/pages_manage_engagement re-added 2026-09-07 --
      // pages_read_engagement was wrongly assumed unapproved here even though
      // instagram.provider.ts's identical Meta app already requests and uses
      // it successfully (confirmed via live logs: Facebook feed/comment sync
      // failing with Meta error #10 asking for exactly this permission, while
      // Instagram's own sync succeeds). pages_manage_engagement (comment
      // replies) hasn't been separately confirmed approved -- if it turns out
      // not to be, Meta rejects the WHOLE request again, same failure mode as
      // before, and this needs to drop back out until verified in App Review.
      scope: ["pages_show_list", "pages_messaging", "pages_manage_metadata", "pages_read_engagement", "pages_manage_engagement"].join(","),
      response_type: "code",
    });
    return `https://www.facebook.com/${this.graphVersion()}/dialog/oauth?${params.toString()}`;
  }

  async exchangeCodeForToken(code: string, redirectUri: string, _codeVerifier?: string, credentials?: OAuthCredentials): Promise<ConnectedAccountProfile[]> {
    const { clientId, clientSecret } = resolveOAuthCredentials(credentials, this.config, "META_OAUTH_CLIENT_ID", "META_OAUTH_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      throw new PlatformNotConfiguredError("Facebook", "META_OAUTH_CLIENT_ID/SECRET is not set");
    }
    const tokenParams = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code });
    const tokenRes = await fetch(`https://graph.facebook.com/${this.graphVersion()}/oauth/access_token?${tokenParams}`);
    if (!tokenRes.ok) throw new Error(`Facebook token exchange failed: ${tokenRes.status}`);
    const { access_token: userToken } = (await tokenRes.json()) as { access_token: string };

    const pagesRes = await fetch(
      `https://graph.facebook.com/${this.graphVersion()}/me/accounts?fields=id,name,access_token,picture&access_token=${userToken}`,
    );
    const pages = (await pagesRes.json()) as { data: { id: string; name: string; access_token: string; picture?: { data: { url: string } } }[] };
    if (!pages.data?.length) throw new Error("No Facebook Page found that this account can manage.");

    // Every Page this login manages, not just the first — a Business
    // Manager admin or an agency login can see several at once, and each
    // one needs its own connect option (Part: multi-account OAuth picker).
    return pages.data.map((page) => ({
      externalAccountId: page.id,
      username: page.name,
      profileImageUrl: page.picture?.data?.url,
      accountType: "page",
      accessToken: page.access_token, // Page access token, not the user token — this is what publish() needs
    }));
  }

  async refreshAccessToken(account: SocialAccount): Promise<{ accessToken: string; expiresAt?: Date }> {
    if (!account.accessTokenEnc) throw new PlatformNotConfiguredError("Facebook", "no stored access token");
    // Page tokens derived from a long-lived user token don't expire under
    // normal use; nothing to actively refresh here in V1.
    return { accessToken: this.encryption.decrypt(account.accessTokenEnc) };
  }

  async publish(account: SocialAccount, input: PublishInput): Promise<PublishResult> {
    if (!account.accessTokenEnc || !account.externalAccountId) {
      throw new PlatformNotConfiguredError("Facebook", `account ${account.username} has no stored connection`);
    }
    const accessToken = this.encryption.decrypt(account.accessTokenEnc);
    const message = [input.content, ...input.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`))].join("\n\n");

    const endpoint = input.mediaUrls[0]
      ? `https://graph.facebook.com/${this.graphVersion()}/${account.externalAccountId}/photos`
      : `https://graph.facebook.com/${this.graphVersion()}/${account.externalAccountId}/feed`;
    const body = input.mediaUrls[0]
      ? { url: input.mediaUrls[0], caption: message, access_token: accessToken }
      : { message, access_token: accessToken };

    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Facebook publish failed: ${res.status} ${await res.text()}`);
    const result = (await res.json()) as { id: string; post_id?: string };
    return { externalPostId: result.post_id ?? result.id };
  }

  async listFeed(account: SocialAccount): Promise<FeedItem[]> {
    if (!account.accessTokenEnc || !account.externalAccountId) {
      throw new PlatformNotConfiguredError("Facebook", `account ${account.username} has no stored connection`);
    }
    const accessToken = this.encryption.decrypt(account.accessTokenEnc);
    const res = await fetch(
      `https://graph.facebook.com/${this.graphVersion()}/${account.externalAccountId}/posts` +
        `?fields=id,message,created_time,permalink_url,full_picture,likes.summary(true),comments.summary(true)` +
        `&access_token=${accessToken}`,
    );
    if (!res.ok) throw new Error(`Facebook feed fetch failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as {
      data: {
        id: string;
        message?: string;
        created_time: string;
        permalink_url?: string;
        full_picture?: string;
        likes?: { summary?: { total_count?: number } };
        comments?: { summary?: { total_count?: number } };
      }[];
    };
    return (body.data ?? []).map((p) => ({
      externalPostId: p.id,
      content: p.message ?? "",
      mediaUrl: p.full_picture,
      permalink: p.permalink_url,
      postedAt: new Date(p.created_time),
      likeCount: p.likes?.summary?.total_count ?? 0,
      commentCount: p.comments?.summary?.total_count ?? 0,
    }));
  }

  /** `followers_count` is a direct Page field, not an Insights metric --
   *  deliberately not using the legacy `page_fans` Insights metric, which
   *  Meta deprecated in Graph API v10.0. Engagement/reach come from the
   *  Insights endpoint proper, requested independently and swallowed on
   *  failure per-metric rather than all-or-nothing: Meta periodically
   *  deprecates individual page_* metrics, and one metric going stale must
   *  never take the follower count (the one field with no substitute) down
   *  with it. */
  async getAccountInsights(account: SocialAccount): Promise<AccountInsights> {
    if (!account.accessTokenEnc || !account.externalAccountId) {
      throw new PlatformNotConfiguredError("Facebook", `account ${account.username} has no stored connection`);
    }
    const accessToken = this.encryption.decrypt(account.accessTokenEnc);
    const insights: AccountInsights = {};

    const pageRes = await fetch(
      `https://graph.facebook.com/${this.graphVersion()}/${account.externalAccountId}?fields=followers_count&access_token=${accessToken}`,
    );
    if (pageRes.ok) {
      const page = (await pageRes.json()) as { followers_count?: number };
      insights.followerCount = page.followers_count;
    }

    try {
      const insightsRes = await fetch(
        `https://graph.facebook.com/${this.graphVersion()}/${account.externalAccountId}/insights` +
          `?metric=page_impressions_unique&period=days_28&access_token=${accessToken}`,
      );
      if (insightsRes.ok) {
        const body = (await insightsRes.json()) as { data: { name: string; values: { value: number }[] }[] };
        const reach = body.data?.find((m) => m.name === "page_impressions_unique");
        insights.reach = reach?.values[reach.values.length - 1]?.value;
      }
    } catch {
      // Metric names on this endpoint are the part of Meta's API most prone
      // to deprecation — a failure here must not cost us followerCount above.
    }

    return insights;
  }

  /** Field-expansion in one call (`posts?fields=...,comments{...}`) rather
   *  than a posts call followed by N per-post comment calls -- the same
   *  "one call, not one per item" reasoning listFeed already follows.
   *  `comments{...}` only returns top-level comments' own direct replies
   *  nested under them by default; deeper nesting isn't fetched in V1.
   *
   *  Reading/replying to Page comments needs pages_read_engagement (read)
   *  and pages_manage_engagement (reply) -- neither is currently requested
   *  in getOAuthUrl above, which already explains why: this app previously
   *  had pages_manage_posts/pages_read_engagement rejected outright by Meta
   *  ("Invalid Scopes", confirmed 2026-08-27), which breaks the ENTIRE OAuth
   *  request, not just the one feature needing it. Same caution applies here
   *  as instagram.provider.ts's identical situation -- this will throw a
   *  real Meta permissions error until that's verified/approved and added. */
  async listComments(account: SocialAccount): Promise<EngagementComment[]> {
    if (!account.accessTokenEnc || !account.externalAccountId) {
      throw new PlatformNotConfiguredError("Facebook", `account ${account.username} has no stored connection`);
    }
    const accessToken = this.encryption.decrypt(account.accessTokenEnc);
    const res = await fetch(
      `https://graph.facebook.com/${this.graphVersion()}/${account.externalAccountId}/posts` +
        `?fields=id,comments.summary(false){id,message,from,created_time,parent}&access_token=${accessToken}`,
    );
    if (!res.ok) throw new Error(`Facebook comments fetch failed: ${res.status} ${await res.text()}`);
    type RawComment = { id: string; message?: string; from?: { id: string; name?: string }; created_time: string; parent?: { id: string } };
    const body = (await res.json()) as { data: { id: string; comments?: { data: RawComment[] } }[] };
    return (body.data ?? []).flatMap((post) =>
      (post.comments?.data ?? []).map((c) => ({
        externalCommentId: c.id,
        externalPostId: post.id,
        parentCommentId: c.parent?.id,
        authorExternalId: c.from?.id,
        authorName: c.from?.name,
        text: c.message,
        postedAt: new Date(c.created_time),
        fromUs: c.from?.id === account.externalAccountId,
      })),
    );
  }

  /** Replying to a Facebook comment is POSTing to /{comment-id}/comments --
   *  the same endpoint shape as a top-level comment, just addressed at the
   *  comment instead of the post, which is what makes it nest as a reply. */
  async replyToComment(account: SocialAccount, externalCommentId: string, text: string): Promise<{ externalCommentId: string }> {
    if (!account.accessTokenEnc) throw new PlatformNotConfiguredError("Facebook", `account ${account.username} has no stored connection`);
    const accessToken = this.encryption.decrypt(account.accessTokenEnc);
    const res = await fetch(`https://graph.facebook.com/${this.graphVersion()}/${externalCommentId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, access_token: accessToken }),
    });
    if (!res.ok) throw new Error(`Facebook comment reply failed: ${res.status} ${await res.text()}`);
    const result = (await res.json()) as { id: string };
    return { externalCommentId: result.id };
  }

  /** Graph API's /likes edge is generic -- the same POST shape works whether
   *  `objectId` is a post or a comment id, addressed as the Page (not a
   *  person), which is what pages_manage_engagement grants. Real, honest
   *  call: if this permission turns out not to actually be approved for
   *  this app despite requesting it in getOAuthUrl above, this throws
   *  Meta's real error rather than pretending to succeed. */
  private async like(objectId: string, accessToken: string): Promise<void> {
    const res = await fetch(`https://graph.facebook.com/${this.graphVersion()}/${objectId}/likes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: accessToken }),
    });
    if (!res.ok) throw new Error(`Facebook like failed: ${res.status} ${await res.text()}`);
  }

  async likePost(account: SocialAccount, externalPostId: string): Promise<void> {
    if (!account.accessTokenEnc) throw new PlatformNotConfiguredError("Facebook", `account ${account.username} has no stored connection`);
    await this.like(externalPostId, this.encryption.decrypt(account.accessTokenEnc));
  }

  async likeComment(account: SocialAccount, externalCommentId: string): Promise<void> {
    if (!account.accessTokenEnc) throw new PlatformNotConfiguredError("Facebook", `account ${account.username} has no stored connection`);
    await this.like(externalCommentId, this.encryption.decrypt(account.accessTokenEnc));
  }

  async listConversations(account: SocialAccount): Promise<Conversation[]> {
    if (!account.accessTokenEnc || !account.externalAccountId) {
      throw new PlatformNotConfiguredError("Facebook", `account ${account.username} has no stored connection`);
    }
    const accessToken = this.encryption.decrypt(account.accessTokenEnc);
    // limit=25: same "Please reduce the amount of data you're asking for"
    // (Meta error #1) risk this hit for Instagram's identical query on an
    // account with many long-lived threads -- bounded proactively here too.
    const res = await fetch(
      `https://graph.facebook.com/${this.graphVersion()}/${account.externalAccountId}/conversations` +
        `?fields=participants,updated_time,snippet,unread_count&limit=25&access_token=${accessToken}`,
    );
    if (!res.ok) throw new Error(`Facebook conversations fetch failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as {
      data: {
        id: string;
        participants?: { data: { id: string; name?: string }[] };
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
        participantName: other?.name ?? "Unknown",
        lastMessageSnippet: c.snippet,
        lastMessageAt: new Date(c.updated_time),
        unread: (c.unread_count ?? 0) > 0,
      };
    });
  }

  async listMessages(account: SocialAccount, conversationId: string): Promise<ConversationMessage[]> {
    if (!account.accessTokenEnc) throw new PlatformNotConfiguredError("Facebook", `account ${account.username} has no stored connection`);
    const accessToken = this.encryption.decrypt(account.accessTokenEnc);
    const res = await fetch(
      `https://graph.facebook.com/${this.graphVersion()}/${conversationId}/messages` +
        `?fields=id,message,from,created_time&access_token=${accessToken}`,
    );
    if (!res.ok) throw new Error(`Facebook messages fetch failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as {
      data: { id: string; message?: string; from?: { id: string; name?: string }; created_time: string }[];
    };
    // Graph API returns newest-first; reverse for a natural top-to-bottom thread.
    return (body.data ?? [])
      .map((m) => ({
        externalMessageId: m.id,
        fromUs: m.from?.id === account.externalAccountId,
        senderName: m.from?.name ?? "Unknown",
        text: m.message ?? "",
        sentAt: new Date(m.created_time),
      }))
      .reverse();
  }

  async sendMessage(account: SocialAccount, participantId: string, text: string): Promise<void> {
    if (!account.accessTokenEnc || !account.externalAccountId) {
      throw new PlatformNotConfiguredError("Facebook", `account ${account.username} has no stored connection`);
    }
    const accessToken = this.encryption.decrypt(account.accessTokenEnc);
    const res = await fetch(`https://graph.facebook.com/${this.graphVersion()}/me/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: participantId }, message: { text }, access_token: accessToken }),
    });
    if (!res.ok) throw new Error(`Facebook send message failed: ${res.status} ${await res.text()}`);
  }

  async subscribeWebhook(account: SocialAccount): Promise<void> {
    if (!account.accessTokenEnc || !account.externalAccountId) {
      throw new PlatformNotConfiguredError("Facebook", `account ${account.username} has no stored connection`);
    }
    const accessToken = this.encryption.decrypt(account.accessTokenEnc);
    const res = await fetch(
      `https://graph.facebook.com/${this.graphVersion()}/${account.externalAccountId}/subscribed_apps?subscribed_fields=messages&access_token=${accessToken}`,
      { method: "POST" },
    );
    if (!res.ok) throw new Error(`Facebook webhook subscription failed: ${res.status} ${await res.text()}`);
  }
}
