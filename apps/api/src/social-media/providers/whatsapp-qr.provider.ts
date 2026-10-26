import { Injectable } from "@nestjs/common";
import { SocialAccount } from "@prisma/client";
import {
  Conversation,
  ConversationMessage,
  FeedItem,
  PlatformCapabilityUnavailableError,
  PublishResult,
  SocialPlatformCapabilities,
  SocialPlatformProvider,
} from "./social-platform-provider.interface";
import { WhatsAppQrSessionManagerService } from "../whatsapp-qr/whatsapp-qr-session-manager.service";

/**
 * WhatsApp Team Inbox (QR session), via Baileys -- the unofficial,
 * multi-device-protocol alternative to WHATSAPP (Meta's Cloud API,
 * OAuth-connected, see whatsapp.provider.ts). Built for exactly one
 * requirement: let a team share one WhatsApp number without handing out
 * the owner's phone, without the Cloud API's "migrate the number away
 * from the phone" requirement. A distinct platform value on purpose --
 * the connect flow (QR scan, not OAuth), transport (a live socket this
 * provider doesn't own, see WhatsAppQrSessionManagerService), and
 * credential shape (local-disk auth state, not an access token) are all
 * completely different from the Cloud API provider, so sharing one enum
 * value would mean every method here fighting the OAuth-shaped interface
 * instead of honestly not implementing it.
 *
 * Conversation/message state lives in SocialConversation/SocialMessage
 * like every other platform (written by WhatsAppQrSessionManagerService
 * via the same SocialInboxIngestService.persistMessage the Cloud API
 * webhook uses) -- listConversations/listMessages below are therefore
 * unused in practice, same as the Cloud API provider's own (SocialInboxService
 * reads our own tables directly, never these).
 */
@Injectable()
export class WhatsAppQrProvider implements SocialPlatformProvider {
  readonly platform = "WHATSAPP_QR";

  readonly capabilities: SocialPlatformCapabilities = {
    publish: false,
    nativeScheduling: false,
    analytics: false,
    comments: false,
    dms: true,
    likes: false,
    mediaTypes: ["image", "video", "document", "audio"],
    notes:
      "Shared team inbox for a WhatsApp number connected by scanning a QR code (like WhatsApp Web/Desktop) instead " +
      "of Meta's Cloud API -- no OAuth, no dedicating the number away from the owner's phone. Messaging only, same " +
      "as the Cloud API WhatsApp connection: no public feed/posting concept. Unofficial (not Meta's sanctioned API) " +
      "-- connect/disconnect numbers from the Numbers tab, not here.",
  };

  constructor(private readonly sessions: WhatsAppQrSessionManagerService) {}

  getOAuthUrl(): string {
    throw new PlatformCapabilityUnavailableError("WHATSAPP_QR", "connect a number by scanning a QR code from the Numbers tab, not OAuth.");
  }

  async exchangeCodeForToken(): Promise<never> {
    throw new PlatformCapabilityUnavailableError("WHATSAPP_QR", "connect a number by scanning a QR code from the Numbers tab, not OAuth.");
  }

  async refreshAccessToken(): Promise<never> {
    throw new PlatformCapabilityUnavailableError("WHATSAPP_QR", "there is no OAuth token to refresh -- this connection is a QR-scanned device session.");
  }

  async publish(): Promise<PublishResult> {
    throw new PlatformCapabilityUnavailableError("WHATSAPP_QR", "WhatsApp has no public feed or posting concept -- it is a messaging-only channel.");
  }

  async listFeed(): Promise<FeedItem[]> {
    throw new PlatformCapabilityUnavailableError("WHATSAPP_QR", "WhatsApp has no public feed or posting concept -- it is a messaging-only channel.");
  }

  async listConversations(): Promise<Conversation[]> {
    throw new PlatformCapabilityUnavailableError(
      "WHATSAPP_QR",
      "conversations are ingested live from the Baileys session as messages arrive, not fetched on demand -- see SocialInboxService instead.",
    );
  }

  async listMessages(): Promise<ConversationMessage[]> {
    throw new PlatformCapabilityUnavailableError(
      "WHATSAPP_QR",
      "message history is ingested live from the Baileys session as messages arrive, not fetched on demand -- see SocialInboxService instead.",
    );
  }

  async sendMessage(account: SocialAccount, participantId: string, text: string, senderUser?: { id: string; name: string }): Promise<void> {
    await this.sessions.sendMessage(account.id, participantId, text, senderUser);
  }
}
