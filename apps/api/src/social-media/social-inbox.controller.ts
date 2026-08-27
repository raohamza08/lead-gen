import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { SocialPlatform, ConversationStatus } from "@prisma/client";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { ModuleAccessGuard } from "../common/guards/module-access.guard";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims } from "@leadgen/types";
import { SocialInboxService } from "./social-inbox.service";
import { UpdateConversationDto, ReplyDto, CreateNoteDto, UpdateNoteDto } from "./dto/social-inbox.dto";

/**
 * Unified Social Media DM Monitoring (Part: Unified Social Media DM
 * Monitoring Module) — reads/writes the persisted SocialConversation store,
 * never talks to a platform API directly except via reply() -> provider.
 * Gated by the same SOCIAL_MEDIA module flag as SocialMediaController since
 * this is still the social media feature area, just a different surface.
 */
@Controller("social-inbox")
@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule("SOCIAL_MEDIA")
export class SocialInboxController {
  constructor(private readonly service: SocialInboxService) {}

  @Get("stats")
  getStats(@CurrentUser() user: JwtClaims) {
    return this.service.getStats(user);
  }

  @Post("accounts/:accountId/sync")
  syncNow(@CurrentUser() user: JwtClaims, @Param("accountId") accountId: string) {
    return this.service.syncAccountNow(user, accountId);
  }

  @Get("conversations")
  listConversations(
    @CurrentUser() user: JwtClaims,
    @Query("platform") platform?: SocialPlatform,
    @Query("accountId") accountId?: string,
    @Query("status") status?: ConversationStatus,
    @Query("unreadOnly") unreadOnly?: string,
    @Query("search") search?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.service.listConversations(user, {
      platform,
      accountId,
      status,
      unreadOnly: unreadOnly === "true",
      search,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Get("conversations/:id")
  getConversation(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.getConversation(user, id);
  }

  @Patch("conversations/:id")
  updateConversation(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: UpdateConversationDto) {
    return this.service.updateConversation(user, id, dto);
  }

  @Post("conversations/:id/reply")
  reply(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: ReplyDto) {
    return this.service.reply(user, id, dto);
  }

  @Post("conversations/:id/notes")
  createNote(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: CreateNoteDto) {
    return this.service.createNote(user, id, dto);
  }

  @Patch("conversations/:id/notes/:noteId")
  updateNote(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Param("noteId") noteId: string, @Body() dto: UpdateNoteDto) {
    return this.service.updateNote(user, id, noteId, dto);
  }

  @Delete("conversations/:id/notes/:noteId")
  deleteNote(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Param("noteId") noteId: string) {
    return this.service.deleteNote(user, id, noteId);
  }
}
