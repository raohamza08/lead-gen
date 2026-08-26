import { Injectable } from "@nestjs/common";
import { Prisma, SocialAccount } from "@prisma/client";
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
  sentAt: Date;
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
            unreadCount: input.fromUs ? 0 : 1,
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
            ...(!input.fromUs ? { unreadCount: { increment: 1 } } : {}),
            ...(input.contactName ? { contactName: input.contactName } : {}),
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
    if (result.isNew && !input.fromUs) {
      this.realtime.emitToOrg(socialAccount.orgId, "socialInbox.messageReceived", {
        conversationId: result.conversationId,
        socialAccountId: socialAccount.id,
      });
      await this.notifications.notify(socialAccount.orgId, {
        type: "SOCIAL_MESSAGE_RECEIVED",
        severity: "WARNING",
        conversationId: result.conversationId,
        message: `New ${socialAccount.platform} message on @${socialAccount.username}${input.senderName ? ` from ${input.senderName}` : ""}.`,
      });
    }

    return result;
  }
}
