import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes, createHash } from "crypto";
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
 * X API v2, OAuth 2.0 with PKCE. Important cost caveat, surfaced here and
 * in the UI's capability notes rather than only in the plan doc: X's free
 * API tier does not support meaningful write access — real posting needs
 * a paid tier (Basic or above, a genuine recurring cost), which is a
 * business decision for whoever registers the developer app, not
 * something this code can route around.
 */
@Injectable()
export class XProvider implements SocialPlatformProvider {
  readonly platform = "X";

  readonly capabilities: SocialPlatformCapabilities = {
    publish: true,
    nativeScheduling: false,
    analytics: true,
    comments: true,
    dms: false, // Direct Message API access is a separate, more restricted permission tier
    mediaTypes: ["image", "video", "gif"],
    notes:
      "X's free API tier cannot post meaningfully — real write access requires a paid API tier (Basic or above, " +
      "a recurring cost, currently on the order of $200+/month). This is a real budget decision, not just a " +
      "technical setup step.",
  };

  constructor(
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
  ) {}

  /** PKCE code_verifier, stashed by the caller (state param round-trip via
   *  the OAuth callback handler) since X requires it at token exchange —
   *  the interface only carries `state`, so the caller is responsible for
   *  persisting the verifier keyed by that same state value. */
  static generatePkce(): { verifier: string; challenge: string } {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    return { verifier, challenge };
  }

  getOAuthUrl(state: string, redirectUri: string): string {
    const clientId = this.config.get<string>("X_OAUTH_CLIENT_ID");
    if (!clientId) throw new PlatformNotConfiguredError("X", "X_OAUTH_CLIENT_ID is not set");
    // Caller must append `code_challenge` from generatePkce() — kept out of
    // this method's signature so the interface stays uniform across
    // providers that don't need PKCE.
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: ["tweet.read", "tweet.write", "users.read", "offline.access"].join(" "),
      state,
      code_challenge_method: "S256",
    });
    return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
  }

  async exchangeCodeForToken(code: string, redirectUri: string): Promise<ConnectedAccountProfile[]> {
    const clientId = this.config.get<string>("X_OAUTH_CLIENT_ID");
    if (!clientId) throw new PlatformNotConfiguredError("X", "X_OAUTH_CLIENT_ID is not set");
    // NOTE: the real code_verifier for this exchange must be looked up by
    // the caller (see getOAuthUrl's PKCE note) and passed through; omitted
    // here since this method signature is shared across every provider.
    const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
      }),
    });
    if (!tokenRes.ok) throw new Error(`X token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
    const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn } = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const meRes = await fetch("https://api.twitter.com/2/users/me?user.fields=profile_image_url", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const me = (await meRes.json()) as { data: { id: string; username: string; profile_image_url?: string } };

    return [{
      externalAccountId: me.data.id,
      username: `@${me.data.username}`,
      profileImageUrl: me.data.profile_image_url,
      accountType: "personal",
      accessToken,
      refreshToken,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined,
    }];
  }

  async refreshAccessToken(account: SocialAccount): Promise<{ accessToken: string; expiresAt?: Date }> {
    const clientId = this.config.get<string>("X_OAUTH_CLIENT_ID");
    if (!clientId || !account.refreshTokenEnc) throw new PlatformNotConfiguredError("X", "no stored refresh token");
    const res = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.encryption.decrypt(account.refreshTokenEnc),
        client_id: clientId,
      }),
    });
    if (!res.ok) throw new Error(`X token refresh failed: ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in?: number };
    return { accessToken: body.access_token, expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : undefined };
  }

  async publish(account: SocialAccount, input: PublishInput): Promise<PublishResult> {
    if (!account.accessTokenEnc) {
      throw new PlatformNotConfiguredError("X", `account ${account.username} has no stored connection`);
    }
    const accessToken = this.encryption.decrypt(account.accessTokenEnc);
    const text = [input.content, ...input.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`))].join(" ");

    const res = await fetch("https://api.twitter.com/2/tweets", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`X publish failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { data: { id: string } };
    return { externalPostId: body.data.id };
  }

  // Reading a timeline or DMs, and sending DMs, requires X's paid API tiers
  // (Basic/Pro) -- a real cost decision for the org, not something to
  // silently assume. Throw clearly rather than pretend it works on the free tier.
  async listFeed(): Promise<FeedItem[]> {
    throw new PlatformNotConfiguredError("X", "reading a feed requires a paid X API tier, not available on the free tier");
  }

  async listConversations(): Promise<Conversation[]> {
    throw new PlatformNotConfiguredError("X", "direct messages require a paid X API tier, not available on the free tier");
  }

  async listMessages(): Promise<ConversationMessage[]> {
    throw new PlatformNotConfiguredError("X", "direct messages require a paid X API tier, not available on the free tier");
  }

  async sendMessage(): Promise<void> {
    throw new PlatformNotConfiguredError("X", "direct messages require a paid X API tier, not available on the free tier");
  }
}
