import { Controller, Get, Param, Patch, Post, Body, Query, UseGuards } from "@nestjs/common";
import { SocialPlatform, EngagementStatus } from "@prisma/client";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { ModuleAccessGuard } from "../common/guards/module-access.guard";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims } from "@leadgen/types";
import { SocialEngagementService } from "./social-engagement.service";
import { UpdateCommentDto, ReplyToCommentDto } from "./dto/social-engagement.dto";

/**
 * Engagement Center (Part: Social Hub Engagement, 2026-09-07) — comments on
 * our own posts, reads/writes the persisted SocialComment store. Same
 * shape and same SOCIAL_MEDIA-or-SOCIAL_ENGAGEMENT module gate as
 * SocialInboxController (Part: narrow Social Inbox + Engagement-only
 * access, 2026-09-07), just a different surface (comments, not DMs).
 */
@Controller("social-engagement")
@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule(["SOCIAL_MEDIA", "SOCIAL_ENGAGEMENT"])
export class SocialEngagementController {
  constructor(private readonly service: SocialEngagementService) {}

  @Get("stats")
  getStats(@CurrentUser() user: JwtClaims) {
    return this.service.getStats(user);
  }

  @Post("accounts/:accountId/sync")
  syncNow(@CurrentUser() user: JwtClaims, @Param("accountId") accountId: string) {
    return this.service.syncAccountNow(user, accountId);
  }

  @Get("posts")
  listPosts(
    @CurrentUser() user: JwtClaims,
    @Query("platform") platform?: SocialPlatform,
    @Query("accountId") accountId?: string,
    @Query("unansweredOnly") unansweredOnly?: string,
  ) {
    return this.service.listPostsWithComments(user, { platform, accountId, unansweredOnly: unansweredOnly === "true" });
  }

  @Get("accounts/:accountId/posts/:postId")
  getPost(@CurrentUser() user: JwtClaims, @Param("accountId") accountId: string, @Param("postId") postId: string) {
    return this.service.getPostWithComments(user, accountId, postId);
  }

  @Get("comments")
  listComments(
    @CurrentUser() user: JwtClaims,
    @Query("platform") platform?: SocialPlatform,
    @Query("accountId") accountId?: string,
    @Query("status") status?: EngagementStatus,
    @Query("unansweredOnly") unansweredOnly?: string,
    @Query("assignedToUserId") assignedToUserId?: string,
    @Query("search") search?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.service.listComments(user, {
      platform,
      accountId,
      status,
      unansweredOnly: unansweredOnly === "true",
      assignedToUserId,
      search,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Get("comments/:id")
  getComment(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.getComment(user, id);
  }

  @Patch("comments/:id")
  updateComment(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: UpdateCommentDto) {
    return this.service.updateComment(user, id, dto);
  }

  @Post("comments/:id/reply")
  reply(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: ReplyToCommentDto) {
    return this.service.reply(user, id, dto);
  }

  @Post("comments/:id/like")
  like(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.like(user, id);
  }
}
