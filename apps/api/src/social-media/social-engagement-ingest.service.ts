import { Injectable } from "@nestjs/common";
import { SocialAccount, NotificationCategory } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { NotificationsService } from "../notifications/notifications.service";
import { EngagementComment } from "./providers/social-platform-provider.interface";

/**
 * The single write path for a comment landing in the DB (Part: Social Hub
 * Engagement, 2026-09-07) — mirrors SocialInboxIngestService.persistMessage:
 * one place decides how a comment row is created/updated, shared by
 * SocialEngagementSyncWorker's poll (the only ingestion path in this
 * version — see that worker's docblock for why there's no webhook path yet)
 * and SocialEngagementService.reply's own outbound write.
 */
@Injectable()
export class SocialEngagementIngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  async persistComment(socialAccount: SocialAccount, input: EngagementComment): Promise<{ isNew: boolean; commentId: string }> {
    const existing = await this.prisma.socialComment.findUnique({
      where: { socialAccountId_externalCommentId: { socialAccountId: socialAccount.id, externalCommentId: input.externalCommentId } },
    });

    if (existing) {
      // A re-poll observing the same comment again must never regress an
      // already-triaged status (a human marked it RESPONDED/IGNORED) back
      // to NEW -- only fields the platform itself owns get refreshed.
      await this.prisma.socialComment.update({
        where: { id: existing.id },
        data: { text: input.text, authorName: input.authorName, authorProfileImageUrl: input.authorProfileImageUrl },
      });
      return { isNew: false, commentId: existing.id };
    }

    const created = await this.prisma.socialComment.create({
      data: {
        socialAccountId: socialAccount.id,
        externalPostId: input.externalPostId,
        externalCommentId: input.externalCommentId,
        parentCommentId: input.parentCommentId,
        authorExternalId: input.authorExternalId,
        authorName: input.authorName,
        authorProfileImageUrl: input.authorProfileImageUrl,
        text: input.text,
        postedAt: input.postedAt,
        fromUs: input.fromUs,
        // Our own reply lands with fromUs=true and doesn't need a human's
        // attention -- filing it straight to RESPONDED (not NEW) keeps the
        // Engagement queue showing only what's actually unaddressed.
        status: input.fromUs ? "RESPONDED" : "NEW",
      },
    });

    if (!input.fromUs) {
      this.realtime.emitToOrg(socialAccount.orgId, "socialEngagement.commentReceived", {
        commentId: created.id,
        socialAccountId: socialAccount.id,
      });
      await this.notifications.notify(socialAccount.orgId, {
        category: NotificationCategory.SOCIAL,
        type: "SOCIAL_COMMENT_RECEIVED",
        severity: "WARNING",
        title: "New Social Comment",
        message: `New ${socialAccount.platform} comment on @${socialAccount.username}${input.authorName ? ` from ${input.authorName}` : ""}.`,
        entityType: "socialComment",
        entityId: created.id,
        actionUrl: `/social-engagement?commentId=${created.id}`,
      });
    }

    return { isNew: true, commentId: created.id };
  }
}
