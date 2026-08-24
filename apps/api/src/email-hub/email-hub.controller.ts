import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims } from "@leadgen/types";
import { EmailHubService, ListMessagesQuery } from "./email-hub.service";
import { BulkActionDto } from "./dto/bulk-action.dto";
import { CreateTagDto, UpdateTagDto } from "./dto/create-tag.dto";
import { ComposeEmailDto, ReplyMessageDto } from "./dto/reply-message.dto";

/**
 * The unified inbox API (Part: Email Hub). Every read endpoint is scoped by
 * EmailHubService's own account-access check (ADMIN sees everything; anyone
 * else only what EmailAccountAccess grants them) rather than a `@Roles()`
 * guard — the restriction here is per-resource (which mailboxes), not
 * per-role, so RolesGuard's org-wide role check doesn't fit.
 */
@Controller("email-hub")
@UseGuards(JwtAuthGuard)
export class EmailHubController {
  constructor(private readonly emailHub: EmailHubService) {}

  @Get("accounts")
  listAccounts(@CurrentUser() user: JwtClaims) {
    return this.emailHub.listAccounts(user);
  }

  @Get("stats")
  getStats(@CurrentUser() user: JwtClaims) {
    return this.emailHub.getStats(user);
  }

  @Get("tags")
  listTags(@CurrentUser() user: JwtClaims) {
    return this.emailHub.listTags(user.orgId);
  }

  @Post("tags")
  createTag(@CurrentUser() user: JwtClaims, @Body() dto: CreateTagDto) {
    return this.emailHub.createTag(user.orgId, dto);
  }

  @Patch("tags/:id")
  updateTag(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: UpdateTagDto) {
    return this.emailHub.updateTag(user.orgId, id, dto);
  }

  @Delete("tags/:id")
  deleteTag(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.emailHub.deleteTag(user.orgId, id);
  }

  @Get("messages")
  listMessages(@CurrentUser() user: JwtClaims, @Query() query: Record<string, string>) {
    const parsed: ListMessagesQuery = {
      accountId: query.accountId,
      status: query.status as ListMessagesQuery["status"],
      tagIds: query.tagIds ? query.tagIds.split(",") : undefined,
      sender: query.sender,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      hasAttachments: query.hasAttachments === undefined ? undefined : query.hasAttachments === "true",
      search: query.search,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    };
    return this.emailHub.listMessages(user, parsed);
  }

  @Post("messages/bulk")
  bulkAction(@CurrentUser() user: JwtClaims, @Body() dto: BulkActionDto) {
    return this.emailHub.bulkAction(user, dto);
  }

  @Post("messages/:id/reply")
  reply(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: ReplyMessageDto) {
    return this.emailHub.reply(user, id, dto);
  }

  @Post("compose")
  compose(@CurrentUser() user: JwtClaims, @Body() dto: ComposeEmailDto) {
    return this.emailHub.compose(user, dto);
  }

  @Get("threads/:id")
  getThread(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.emailHub.getThread(user, id);
  }

  @Post("threads/:id/add-to-lead")
  addToLead(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.emailHub.addToLead(user, id);
  }
}
