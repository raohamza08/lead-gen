import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { SocialPlatform, SocialPostStatus } from "@prisma/client";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { ModuleAccessGuard } from "../common/guards/module-access.guard";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims } from "@leadgen/types";
import { SocialMediaService } from "./social-media.service";
import { CreatePostDto, RejectPostDto, UpdatePostDto } from "./dto/social-post.dto";
import { CreateContentTemplateDto, CreateHashtagGroupDto, CreateMediaFolderDto, UpdateContentTemplateDto, UpdateHashtagGroupDto } from "./dto/content-library.dto";
import { CreateSocialAutomationDto, GenerateContentDto, UpdateSocialAutomationDto } from "./dto/social-automation.dto";

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200MB — generous enough for a short video, still bounded
const ALLOWED_MIME_PREFIXES = ["image/", "video/"];

/**
 * Day-to-day Social Media API (Part: Social Media Management Module).
 * Account-level configuration (settings, access grants, disconnect) lives
 * under `/settings/social-media` — SocialMediaSettingsController — matching
 * the per-module settings split the rest of the dashboard already uses.
 */
@Controller("social-media")
@UseGuards(JwtAuthGuard, ModuleAccessGuard)
@RequiresModule("SOCIAL_MEDIA")
export class SocialMediaController {
  constructor(private readonly service: SocialMediaService) {}

  @Get("capabilities")
  capabilities() {
    return this.service.getCapabilityRegistry();
  }

  @Get("accounts")
  listAccounts(@CurrentUser() user: JwtClaims) {
    return this.service.listAccounts(user);
  }

  @Get("stats")
  getStats(@CurrentUser() user: JwtClaims) {
    return this.service.getStats(user);
  }

  // ---- Feed & messages (Part: Social Media Hub — read-only feed, human-sent replies) ----

  @Get("accounts/:id/feed")
  getFeed(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.getFeed(user, id);
  }

  @Get("accounts/:id/conversations")
  getConversations(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.getConversations(user, id);
  }

  @Get("accounts/:id/conversations/:conversationId/messages")
  getMessages(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Param("conversationId") conversationId: string) {
    return this.service.getMessages(user, id, conversationId);
  }

  @Post("accounts/:id/conversations/:conversationId/reply")
  sendReply(
    @CurrentUser() user: JwtClaims,
    @Param("id") id: string,
    @Param("conversationId") conversationId: string,
    @Body("text") text: string,
  ) {
    return this.service.sendReply(user, id, conversationId, text);
  }

  // ---- Posts ----

  @Get("posts")
  listPosts(@CurrentUser() user: JwtClaims, @Query() query: Record<string, string>) {
    return this.service.listPosts(user, {
      status: query.status as SocialPostStatus | undefined,
      accountId: query.accountId,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    });
  }

  @Get("posts/:id")
  getPost(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.getPost(user, id);
  }

  @Post("posts")
  createPost(@CurrentUser() user: JwtClaims, @Body() dto: CreatePostDto) {
    return this.service.createPost(user, dto);
  }

  @Patch("posts/:id")
  updatePost(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: UpdatePostDto) {
    return this.service.updatePost(user, id, dto);
  }

  @Post("posts/:id/submit")
  submit(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.submitForReview(user, id);
  }

  @Post("posts/:id/approve")
  approve(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.approve(user, id);
  }

  @Post("posts/:id/reject")
  reject(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: RejectPostDto) {
    return this.service.reject(user, id, dto.reason);
  }

  @Post("posts/:id/schedule")
  schedule(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() body: { scheduledAt?: string }) {
    return this.service.schedule(user, id, body?.scheduledAt);
  }

  @Post("posts/:id/unschedule")
  unschedule(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.cancelSchedule(user, id);
  }

  @Post("posts/:id/retry")
  retry(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.retryFailed(user, id);
  }

  @Delete("posts/:id")
  deletePost(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.deletePost(user, id);
  }

  // ---- Media library ----

  @Get("media")
  listMedia(@CurrentUser() user: JwtClaims, @Query("folderId") folderId?: string) {
    return this.service.listMedia(user.orgId, folderId);
  }

  @Post("media")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  uploadMedia(
    @CurrentUser() user: JwtClaims,
    @UploadedFile() file: Express.Multer.File,
    @Body("folderId") folderId?: string,
  ) {
    if (!file) throw new BadRequestException("No file uploaded");
    if (!ALLOWED_MIME_PREFIXES.some((p) => file.mimetype.startsWith(p))) {
      throw new BadRequestException("Only image and video files are supported");
    }
    return this.service.uploadMedia(user, file, folderId);
  }

  @Delete("media/:id")
  deleteMedia(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.deleteMedia(user.orgId, id);
  }

  @Get("media-folders")
  listFolders(@CurrentUser() user: JwtClaims) {
    return this.service.listFolders(user.orgId);
  }

  @Post("media-folders")
  createFolder(@CurrentUser() user: JwtClaims, @Body() dto: CreateMediaFolderDto) {
    return this.service.createFolder(user.orgId, dto);
  }

  // ---- Hashtag groups ----

  @Get("hashtag-groups")
  listHashtagGroups(@CurrentUser() user: JwtClaims) {
    return this.service.listHashtagGroups(user.orgId);
  }

  @Post("hashtag-groups")
  createHashtagGroup(@CurrentUser() user: JwtClaims, @Body() dto: CreateHashtagGroupDto) {
    return this.service.createHashtagGroup(user.orgId, dto);
  }

  @Patch("hashtag-groups/:id")
  updateHashtagGroup(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: UpdateHashtagGroupDto) {
    return this.service.updateHashtagGroup(user.orgId, id, dto);
  }

  @Delete("hashtag-groups/:id")
  deleteHashtagGroup(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.deleteHashtagGroup(user.orgId, id);
  }

  // ---- Content templates ----

  @Get("templates")
  listTemplates(@CurrentUser() user: JwtClaims) {
    return this.service.listContentTemplates(user.orgId);
  }

  @Post("templates")
  createTemplate(@CurrentUser() user: JwtClaims, @Body() dto: CreateContentTemplateDto) {
    return this.service.createContentTemplate(user.orgId, dto);
  }

  @Patch("templates/:id")
  updateTemplate(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: UpdateContentTemplateDto) {
    return this.service.updateContentTemplate(user.orgId, id, dto);
  }

  @Delete("templates/:id")
  deleteTemplate(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.deleteContentTemplate(user.orgId, id);
  }

  // ---- AI content generation ----

  @Post("generate")
  generate(@CurrentUser() user: JwtClaims, @Body() dto: GenerateContentDto) {
    return this.service.generateContent(user, {
      mode: dto.mode,
      platform: dto.platform as SocialPlatform,
      brief: dto.brief,
      sourceContent: dto.sourceContent,
      sourcePlatform: dto.sourcePlatform as SocialPlatform | undefined,
      accountId: dto.accountId,
    });
  }

  // ---- Automations ----

  @Get("automations")
  listAutomations(@CurrentUser() user: JwtClaims) {
    return this.service.listAutomations(user.orgId);
  }

  @Post("automations")
  createAutomation(@CurrentUser() user: JwtClaims, @Body() dto: CreateSocialAutomationDto) {
    return this.service.createAutomation(user, dto);
  }

  @Patch("automations/:id")
  updateAutomation(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: UpdateSocialAutomationDto) {
    return this.service.updateAutomation(user.orgId, id, dto);
  }

  @Delete("automations/:id")
  deleteAutomation(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.deleteAutomation(user.orgId, id);
  }

  @Get("automations/:id/runs")
  listAutomationRuns(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.listAutomationRuns(user.orgId, id);
  }
}
