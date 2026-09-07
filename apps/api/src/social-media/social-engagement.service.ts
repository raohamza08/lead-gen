import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { EngagementStatus, Prisma, SocialPlatform } from "@prisma/client";
import { JwtClaims, Role } from "@leadgen/types";
import { PrismaService } from "../common/prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { SocialProviderRegistryService } from "./providers/social-provider-registry.service";
import { SocialEngagementIngestService } from "./social-engagement-ingest.service";
import { SocialEngagementSyncWorker } from "./social-engagement-sync.worker";
import { UpdateCommentDto, ReplyToCommentDto } from "./dto/social-engagement.dto";

export interface ListCommentsQuery {
  platform?: SocialPlatform;
  accountId?: string;
  status?: EngagementStatus;
  unansweredOnly?: boolean;
  assignedToUserId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 30;

/**
 * Backs the Engagement Center — comments on our own posts (Part: Social Hub
 * Engagement, 2026-09-07). Access control mirrors SocialInboxService's
 * canView-based split exactly: this is a monitoring concern, not
 * publish/approve, same reasoning that file's own docblock gives.
 */
@Injectable()
export class SocialEngagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly registry: SocialProviderRegistryService,
    private readonly ingest: SocialEngagementIngestService,
    private readonly syncWorker: SocialEngagementSyncWorker,
  ) {}

  async syncAccountNow(user: JwtClaims, accountId: string) {
    const account = await this.prisma.socialAccount.findFirst({ where: { id: accountId, orgId: user.orgId } });
    if (!account) throw new NotFoundException("Social account not found");
    try {
      await this.syncWorker.syncAccount(account);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    return { synced: true };
  }

  private async viewableAccountIds(user: JwtClaims): Promise<string[] | null> {
    if (user.role === Role.ADMIN) return null;
    const grants = await this.prisma.socialAccountAccess.findMany({
      where: { userId: user.sub, canView: true },
      select: { accountId: true },
    });
    return grants.map((g) => g.accountId);
  }

  private async assertCommentAccess(user: JwtClaims, commentId: string) {
    const comment = await this.prisma.socialComment.findFirst({
      where: { id: commentId, socialAccount: { orgId: user.orgId } },
      include: { socialAccount: true },
    });
    if (!comment) throw new NotFoundException("Comment not found");
    if (user.role !== Role.ADMIN) {
      const grant = await this.prisma.socialAccountAccess.findUnique({
        where: { userId_accountId: { userId: user.sub, accountId: comment.socialAccountId } },
      });
      if (!grant?.canView) throw new ForbiddenException("You do not have access to this account's comments");
    }
    return comment;
  }

  async listComments(user: JwtClaims, query: ListCommentsQuery) {
    const accountIds = await this.viewableAccountIds(user);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.SocialCommentWhereInput = {
      socialAccount: { orgId: user.orgId, ...(query.platform ? { platform: query.platform } : {}) },
      ...(accountIds ? { socialAccountId: { in: accountIds } } : {}),
      ...(query.accountId ? { socialAccountId: query.accountId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.unansweredOnly ? { status: "NEW" } : {}),
      ...(query.assignedToUserId ? { assignedToUserId: query.assignedToUserId } : {}),
      fromUs: false, // our own replies never appear as a row to triage, only inline under the comment they answered
      ...(query.search?.trim()
        ? {
            OR: [
              { authorName: { contains: query.search, mode: "insensitive" } },
              { text: { contains: query.search, mode: "insensitive" } },
              { socialAccount: { username: { contains: query.search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    const [comments, total] = await Promise.all([
      this.prisma.socialComment.findMany({
        where,
        orderBy: { postedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          socialAccount: { select: { id: true, platform: true, username: true, displayName: true, profileImageUrl: true } },
          assignedToUser: { select: { id: true, name: true } },
        },
      }),
      this.prisma.socialComment.count({ where }),
    ]);

    return { comments, total, page, pageSize };
  }

  async getComment(user: JwtClaims, id: string) {
    const comment = await this.assertCommentAccess(user, id);
    // Our own replies to this exact comment -- matched on parentCommentId,
    // which is only ever set by ingest for a genuine platform-reported
    // nested reply (see EngagementComment.parentCommentId's docblock).
    const replies = await this.prisma.socialComment.findMany({
      where: { socialAccountId: comment.socialAccountId, parentCommentId: comment.externalCommentId },
      orderBy: { postedAt: "asc" },
    });
    return { ...comment, replies };
  }

  async updateComment(user: JwtClaims, id: string, dto: UpdateCommentDto) {
    const comment = await this.assertCommentAccess(user, id);
    const updated = await this.prisma.socialComment.update({
      where: { id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.assignedToUserId !== undefined ? { assignedToUserId: dto.assignedToUserId || null } : {}),
      },
    });
    this.realtime.emitToOrg(comment.socialAccount.orgId, "socialEngagement.commentUpdated", { commentId: id });
    return updated;
  }

  async reply(user: JwtClaims, id: string, dto: ReplyToCommentDto) {
    const comment = await this.assertCommentAccess(user, id);
    const provider = this.registry.for(comment.socialAccount.platform);
    if (!provider.replyToComment) {
      throw new BadRequestException(`${comment.socialAccount.platform} doesn't support replying to comments via its official API.`);
    }
    let result: { externalCommentId: string };
    try {
      result = await provider.replyToComment(comment.socialAccount, comment.externalCommentId, dto.text);
    } catch (err) {
      // Same reasoning as SocialInboxService.reply's identical catch: a
      // provider's PlatformNotConfiguredError (or a real API error) is
      // operator-actionable, not a bug.
      throw new BadRequestException((err as Error).message);
    }

    const { commentId } = await this.ingest.persistComment(comment.socialAccount, {
      externalCommentId: result.externalCommentId,
      externalPostId: comment.externalPostId,
      parentCommentId: comment.externalCommentId,
      text: dto.text,
      postedAt: new Date(),
      fromUs: true,
    });

    // The comment we replied to is now handled -- reflect that immediately
    // rather than waiting for the next 10-minute poll to re-observe it.
    await this.prisma.socialComment.update({ where: { id: comment.id }, data: { status: "RESPONDED" } });

    return { sent: true, commentId };
  }

  async getStats(user: JwtClaims) {
    const accountIds = await this.viewableAccountIds(user);
    const where: Prisma.SocialCommentWhereInput = {
      socialAccount: { orgId: user.orgId },
      ...(accountIds ? { socialAccountId: { in: accountIds } } : {}),
      fromUs: false,
    };
    const [total, unanswered, responded, ignored] = await Promise.all([
      this.prisma.socialComment.count({ where }),
      this.prisma.socialComment.count({ where: { ...where, status: "NEW" } }),
      this.prisma.socialComment.count({ where: { ...where, status: "RESPONDED" } }),
      this.prisma.socialComment.count({ where: { ...where, status: "IGNORED" } }),
    ]);
    return { total, unanswered, responded, ignored };
  }
}
