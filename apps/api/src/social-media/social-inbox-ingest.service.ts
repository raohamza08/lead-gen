import { Injectable } from "@nestjs/common";
import { Prisma, SocialAccount, NotificationCategory } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { NotificationsService } from "../notifications/notifications.service";

export interface IncomingMessageInput {
  externalConversationId: string;
  contactExternalId?: string;
  contactName?: string;
  contactUsername?: string;
  contactProfileImageUrl?: string;
  externalMessageId: string;
  fromUs: boolean;
  senderName?: string;
  messageText?: string;
  mediaUrl?: string;
  mediaMimeType?: string;
  mediaFilename?: string;
  sentAt: Date;
  /** True for a message replayed from a platform's own chat-history backfill
   *  (Part: WhatsApp Team Inbox history backfill, 2026-10-26) rather than
   *  something that just arrived -- a freshly connected WhatsApp QR number
   *  can replay months of real history in one burst, which must not inflate
   *  unreadCount to a meaningless count of everything that ever happened,
   *  nor fire a realtime/notification per historical message (hundreds at
   *  once). Omitted/false preserves the exact existing behavior every other
   *  caller (webhook, reconciliation poll) already relies on. */
  isHistoryBackfill?: boolean;
}

/**
 * The single write path for an inbound/outbound social message landing in
 * the DB (Part: Unified Social Media DM Monitoring) — shared by
 * SocialWebhookController (real-time) and SocialInboxSyncWorker
 * (reconciliation poll) so there is exactly one place that decides how a
 * conversation's rollup fields get updated, not two that could drift.
 *
 * Contact display fields (name/username/avatar) are deliberately best-effort
 * here — the webhook payload itself only carries the sender's platform id,
 * not their profile info. Left blank on first sight, filled in by whichever
 * ingestion path next has real data (typically the reconciliation poll,
 * which calls listConversations() and does have participantName) rather
 * than adding a same-call profile-fetch that isn't part of this phase.
 */
@Injectable()
export class SocialInboxIngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  async persistMessage(
    socialAccount: SocialAccount,
    input: IncomingMessageInput,
  ): Promise<{ isNew: boolean; conversationId: string }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.socialConversation.findUnique({
        where: {
          socialAccountId_externalConversationId: {
            socialAccountId: socialAccount.id,
            externalConversationId: input.externalConversationId,
          },
        },
      });

      const conversation =
        existing ??
        (await tx.socialConversation.create({
          data: {
            socialAccountId: socialAccount.id,
            externalConversationId: input.externalConversationId,
            contactExternalId: input.contactExternalId,
            contactName: input.contactName,
            contactUsername: input.contactUsername,
            contactProfileImageUrl: input.contactProfileImageUrl,
            lastMessage: input.messageText,
            lastMessageAt: input.sentAt,
            unreadCount: input.fromUs || input.isHistoryBackfill ? 0 : 1,
          },
        }));

      try {
        await tx.socialMessage.create({
          data: {
            conversationId: conversation.id,
            externalMessageId: input.externalMessageId,
            fromUs: input.fromUs,
            senderName: input.senderName,
            messageText: input.messageText,
            mediaUrl: input.mediaUrl,
            mediaMimeType: input.mediaMimeType,
            mediaFilename: input.mediaFilename,
            sentAt: input.sentAt,
          },
        });
      } catch (err) {
        // P2002 = unique constraint on [conversationId, externalMessageId] --
        // a webhook retry or the poll re-observing an already-ingested
        // message, not a real error. Same dedup shape EmailHubSyncWorker
        // already uses for inbound email.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          return { isNew: false, conversationId: conversation.id };
        }
        throw err;
      }

      // The just-created branch above already reflects this first message's
      // rollup fields -- only an existing conversation needs updating, and
      // only "last message" preview fields when this message is genuinely
      // the newest one seen (a reconciliation pass can backfill an older
      // missed message after a newer one already arrived via webhook, and
      // must not regress what's already showing).
      if (existing) {
        const isNewest = input.sentAt >= existing.lastMessageAt;
        await tx.socialConversation.update({
          where: { id: conversation.id },
          data: {
            ...(isNewest ? { lastMessage: input.messageText, lastMessageAt: input.sentAt } : {}),
            ...(!input.fromUs && !input.isHistoryBackfill ? { unreadCount: { increment: 1 } } : {}),
            // Never overwrite a manually-set name (Part: WhatsApp Team
            // Inbox contact rename, 2026-10-26, bug fix -- confirmed in
            // production: the platform's own reported name, which for
            // WhatsApp QR's LID contacts is frequently just a masked
            // placeholder, kept silently clobbering a real name a teammate
            // had just set). See SocialConversation.contactNameLocked's
            // own docblock.
            ...(input.contactName && !existing.contactNameLocked ? { contactName: input.contactName } : {}),
            ...(input.contactUsername ? { contactUsername: input.contactUsername } : {}),
            ...(input.contactProfileImageUrl ? { contactProfileImageUrl: input.contactProfileImageUrl } : {}),
          },
        });
      }

      return { isNew: true, conversationId: conversation.id };
    });

    // Never notify about our own outbound reply landing in the DB, and only
    // for a genuinely new message -- a dedup no-op must not spam a second
    // realtime/notification for something already surfaced once.
    if (result.isNew && !input.fromUs && !input.isHistoryBackfill) {
      this.realtime.emitToOrg(socialAccount.orgId, "socialInbox.messageReceived", {
        conversationId: result.conversationId,
        socialAccountId: socialAccount.id,
      });
      await this.notifications.notify(socialAccount.orgId, {
        category: NotificationCategory.SOCIAL,
        type: "SOCIAL_MESSAGE_RECEIVED",
        severity: "WARNING",
        title: "New Social Message",
        conversationId: result.conversationId,
        message: `New ${socialAccount.platform} message on @${socialAccount.username}${input.senderName ? ` from ${input.senderName}` : ""}.`,
        entityType: "socialConversation",
        entityId: result.conversationId,
        // Points at the platform page's own Inbox tab (Part: Social Inbox
        // removal / per-module messaging, 2026-10-21) — the centralized
        // /social-inbox route no longer exists; messaging now lives inside
        // each platform's own page, which reads ?tab=inbox&conversationId=
        // to preselect the right conversation on load.
        actionUrl: `/social-media/${socialAccount.platform.toLowerCase()}?tab=inbox&conversationId=${result.conversationId}`,
      });
    }

    return result;
  }
}
