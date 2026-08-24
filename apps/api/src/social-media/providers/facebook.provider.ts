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
    dms: false,
    mediaTypes: ["image", "video", "link"],
    notes:
      "Publishes to a Facebook Page (not a personal profile — the Graph API does not support posting to personal " +
      "timelines for third-party apps). Uses the same Meta Developer app as Instagram.",
  };

  constructor(
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
  ) {}

  private graphVersion(): string {
    return this.config.get<string>("META_GRAPH_API_VERSION", "v21.0");
  }

  getOAuthUrl(state: string, redirectUri: string): string {
    const clientId = this.config.get<string>("META_OAUTH_CLIENT_ID");
    if (!clientId) throw new PlatformNotConfiguredError("Facebook", "META_OAUTH_CLIENT_ID is not set");
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope: ["pages_show_list", "pages_manage_posts", "pages_read_engagement"].join(","),
      response_type: "code",
    });
    return `https://www.facebook.com/${this.graphVersion()}/dialog/oauth?${params.toString()}`;
  }

  async exchangeCodeForToken(code: string, redirectUri: string): Promise<ConnectedAccountProfile> {
    const clientId = this.config.get<string>("META_OAUTH_CLIENT_ID");
    const clientSecret = this.config.get<string>("META_OAUTH_CLIENT_SECRET");
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
    const page = pages.data?.[0];
    if (!page) throw new Error("No Facebook Page found that this account can manage.");

    return {
      externalAccountId: page.id,
      username: page.name,
      profileImageUrl: page.picture?.data?.url,
      accountType: "page",
      accessToken: page.access_token, // Page access token, not the user token — this is what publish() needs
    };
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
}
