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
 * WhatsApp Business (Cloud API), via the same Meta Developer app/OAuth
 * client as Facebook/Instagram (Part: API & Provider Architecture — one
 * Meta app, several products). Two structural differences from every other
 * provider here, both real platform limits, not implementation gaps:
 *
 * 1. No feed/posting concept at all — WhatsApp is messaging-only. publish()/
 *    listFeed() throw honestly rather than pretending a no-op success.
 * 2. No message-history read endpoint exists in the Cloud API — only real-
 *    time webhook delivery. listConversations()/listMessages() throw
 *    honestly; SocialInboxSyncWorker's POLLABLE_PLATFORMS deliberately does
 *    not include WHATSAPP, since polling something with no read endpoint
 *    would just be a guaranteed-to-fail round trip every tick.
 *
 * `externalAccountId` stores the WhatsApp *phone number ID* (what
 * /messages sends to) — not the WhatsApp Business Account (WABA) id, which
 * is looked up fresh via the Business Manager hierarchy wherever actually
 * needed (exchange, webhook subscription) rather than stored, since the
 * schema has no dedicated column for it and it's only needed at those two
 * points.
 */
@Injectable()
export class WhatsAppProvider implements SocialPlatformProvider {
  readonly platform = "WHATSAPP";

  readonly capabilities: SocialPlatformCapabilities = {
    publish: false,
    nativeScheduling: false,
    analytics: false,
    comments: false,
    dms: true,
    mediaTypes: ["image", "video", "document", "audio"],
    notes:
      "Messaging only — WhatsApp has no public feed or post concept, so publishing/scheduling isn't offered here. " +
      "Also has no message-history API: conversations only appear from messages received after connecting (real-time " +
      "webhook only, no backfill/reconciliation possible, unlike Facebook/Instagram). Free-form replies only work " +
      "within 24 hours of the customer's last message — outside that window WhatsApp requires a pre-approved message " +
      "template, which isn't built here yet, so a late reply will fail with WhatsApp's own error rather than send.",
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
    if (!clientId) throw new PlatformNotConfiguredError("WhatsApp", "META_OAUTH_CLIENT_ID is not set");
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope: ["whatsapp_business_management", "whatsapp_business_messaging", "business_management"].join(","),
      response_type: "code",
    });
    return `https://www.facebook.com/${this.graphVersion()}/dialog/oauth?${params.toString()}`;
  }

  /** Every WABA this token's Business Manager owns, each with its phone
   *  numbers -- `GET /me/businesses` has no direct "list my WhatsApp
   *  numbers" shortcut, so this is the real, documented three-hop chain. */
  private async listOwnedPhoneNumbers(
    userToken: string,
  ): Promise<{ wabaId: string; phoneNumberId: string; displayPhoneNumber: string; verifiedName: string }[]> {
    const businessesRes = await fetch(
      `https://graph.facebook.com/${this.graphVersion()}/me/businesses?access_token=${userToken}`,
    );
    if (!businessesRes.ok) throw new Error(`WhatsApp businesses lookup failed: ${businessesRes.status} ${await businessesRes.text()}`);
    const businesses = (await businessesRes.json()) as { data: { id: string }[] };

    const results: { wabaId: string; phoneNumberId: string; displayPhoneNumber: string; verifiedName: string }[] = [];
    for (const business of businesses.data ?? []) {
      const wabaRes = await fetch(
        `https://graph.facebook.com/${this.graphVersion()}/${business.id}/owned_whatsapp_business_accounts?access_token=${userToken}`,
      );
      if (!wabaRes.ok) continue; // this business may just not have WhatsApp set up -- not an error
      const wabas = (await wabaRes.json()) as { data: { id: string }[] };
      for (const waba of wabas.data ?? []) {
        const phonesRes = await fetch(
          `https://graph.facebook.com/${this.graphVersion()}/${waba.id}/phone_numbers?access_token=${userToken}`,
        );
        if (!phonesRes.ok) continue;
        const phones = (await phonesRes.json()) as {
          data: { id: string; display_phone_number: string; verified_name: string }[];
        };
        for (const phone of phones.data ?? []) {
          results.push({
            wabaId: waba.id,
            phoneNumberId: phone.id,
            displayPhoneNumber: phone.display_phone_number,
            verifiedName: phone.verified_name,
          });
        }
      }
    }
    return results;
  }

  async exchangeCodeForToken(code: string, redirectUri: string): Promise<ConnectedAccountProfile[]> {
    const clientId = this.clientId();
    const clientSecret = this.clientSecret();
    if (!clientId || !clientSecret) {
      throw new PlatformNotConfiguredError("WhatsApp", "META_OAUTH_CLIENT_ID/SECRET is not set");
    }
    const tokenParams = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code });
    const tokenRes = await fetch(`https://graph.facebook.com/${this.graphVersion()}/oauth/access_token?${tokenParams}`);
    if (!tokenRes.ok) throw new Error(`WhatsApp token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
    const { access_token: userToken } = (await tokenRes.json()) as { access_token: string };

    const numbers = await this.listOwnedPhoneNumbers(userToken);
    if (numbers.length === 0) {
      throw new Error("No WhatsApp Business phone number found in any Business Manager this login can access.");
    }

    // Subscribe the app to each WABA's messages right away -- cheap (one
    // POST per distinct WABA), and means a first-time connect doesn't rely
    // on someone also clicking "Subscribe webhook" separately afterward.
    const subscribedWabas = new Set<string>();
    for (const n of numbers) {
      if (subscribedWabas.has(n.wabaId)) continue;
      subscribedWabas.add(n.wabaId);
      await fetch(
        `https://graph.facebook.com/${this.graphVersion()}/${n.wabaId}/subscribed_apps?access_token=${userToken}`,
        { method: "POST" },
      ).catch(() => undefined); // best-effort, same as subscribeWebhook below
    }

    return numbers.map((n) => ({
      externalAccountId: n.phoneNumberId,
      username: n.displayPhoneNumber,
      displayName: n.verifiedName,
      accountType: "whatsapp_phone_number",
      accessToken: userToken,
    }));
  }

  async refreshAccessToken(account: SocialAccount): Promise<{ accessToken: string; expiresAt?: Date }> {
    const clientId = this.clientId();
    const clientSecret = this.clientSecret();
    if (!clientId || !clientSecret || !account.accessTokenEnc) {
      throw new PlatformNotConfiguredError("WhatsApp", "no stored access token to refresh");
    }
    const current = this.encryption.decrypt(account.accessTokenEnc);
    const params = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: clientId,
      client_secret: clientSecret,
      fb_exchange_token: current,
    });
    const res = await fetch(`https://graph.facebook.com/${this.graphVersion()}/oauth/access_token?${params}`);
    if (!res.ok) throw new Error(`WhatsApp token refresh failed: ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in?: number };
    return {
      accessToken: body.access_token,
      expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000) : undefined,
    };
  }

  async publish(): Promise<PublishResult> {
    throw new PlatformNotConfiguredError("WhatsApp", "WhatsApp has no public feed or posting concept -- it is a messaging-only channel.");
  }

  async listFeed(): Promise<FeedItem[]> {
    throw new PlatformNotConfiguredError("WhatsApp", "WhatsApp has no public feed or posting concept -- it is a messaging-only channel.");
  }

  async listConversations(): Promise<Conversation[]> {
    throw new PlatformNotConfiguredError(
      "WhatsApp",
      "the Cloud API has no endpoint to read message history -- conversations only appear from messages received after connecting, via webhook.",
    );
  }

  async listMessages(): Promise<ConversationMessage[]> {
    throw new PlatformNotConfiguredError(
      "WhatsApp",
      "the Cloud API has no endpoint to read message history -- conversations only appear from messages received after connecting, via webhook.",
    );
  }

  async sendMessage(account: SocialAccount, participantId: string, text: string): Promise<void> {
    if (!account.accessTokenEnc || !account.externalAccountId) {
      throw new PlatformNotConfiguredError("WhatsApp", `account ${account.username} has no stored connection`);
    }
    const accessToken = this.encryption.decrypt(account.accessTokenEnc);
    const res = await fetch(`https://graph.facebook.com/${this.graphVersion()}/${account.externalAccountId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: participantId,
        type: "text",
        text: { body: text },
      }),
    });
    if (!res.ok) {
      // Most common real failure: outside the 24h customer service window
      // with no approved template -- surfaced verbatim, not swallowed,
      // since there's no fallback template flow built to retry with.
      throw new Error(`WhatsApp send message failed: ${res.status} ${await res.text()}`);
    }
  }

  async subscribeWebhook(account: SocialAccount): Promise<void> {
    if (!account.accessTokenEnc || !account.externalAccountId) {
      throw new PlatformNotConfiguredError("WhatsApp", `account ${account.username} has no stored connection`);
    }
    const accessToken = this.encryption.decrypt(account.accessTokenEnc);
    const numbers = await this.listOwnedPhoneNumbers(accessToken);
    const match = numbers.find((n) => n.phoneNumberId === account.externalAccountId);
    if (!match) throw new Error("Could not find this phone number's WhatsApp Business Account to subscribe.");
    const res = await fetch(
      `https://graph.facebook.com/${this.graphVersion()}/${match.wabaId}/subscribed_apps?access_token=${accessToken}`,
      { method: "POST" },
    );
    if (!res.ok) throw new Error(`WhatsApp webhook subscription failed: ${res.status} ${await res.text()}`);
  }
}
