import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConversationStatus, Prisma, SocialPlatform } from "@prisma/client";
import { JwtClaims, Role } from "@leadgen/types";
import { PrismaService } from "../common/prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { SocialProviderRegistryService } from "./providers/social-provider-registry.service";
import { SocialInboxIngestService } from "./social-inbox-ingest.service";
import { SocialInboxSyncWorker } from "./social-inbox-sync.worker";
import { UpdateConversationDto, ReplyDto, CreateNoteDto, UpdateNoteDto } from "./dto/social-inbox.dto";

export interface ListConversationsQuery {
  platform?: SocialPlatform;
  accountId?: string;
  status?: ConversationStatus;
  unreadOnly?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 30;

/**
 * Backs the Social Inbox — the unified, persisted view across every
 * connected account's conversations (Part: Unified Social Media DM
 * Monitoring). Deliberately does not touch Lead/CRM anything: no import
 * from the leads module anywhere in this file.
 */
@Injectable()
export class SocialInboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly registry: SocialProviderRegistryService,
    private readonly ingest: SocialInboxIngestService,
    private readonly syncWorker: SocialInboxSyncWorker,
  ) {}

  /** On-demand reconciliation pass for one account (Part: Unified Social
   *  Media DM Monitoring) — same logic the 10-minute scheduled tick runs,
   *  just callable right after a connect instead of waiting for the next
   *  tick. */
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

  // ---------------------------------------------------------------------
  // Access control — same shape as SocialMediaService's, but scoped by
  // canView (monitoring access) rather than canPublish/canApprove
  // (scheduling/calendar access) since these are separate concerns now
  // that DM monitoring is its own module.
  // ---------------------------------------------------------------------

  private async viewableAccountIds(user: JwtClaims): Promise<string[] | null> {
    if (user.role === Role.ADMIN) return null;
    const grants = await this.prisma.socialAccountAccess.findMany({
      where: { userId: user.sub, canView: true },
      select: { accountId: true },
    });
    return grants.map((g) => g.accountId);
  }

  private async assertConversationAccess(user: JwtClaims, conversationId: string) {
    const conversation = await this.prisma.socialConversation.findFirst({
      where: { id: conversationId, socialAccount: { orgId: user.orgId } },
      include: { socialAccount: true },
    });
    if (!conversation) throw new NotFoundException("Conversation not found");
    if (user.role !== Role.ADMIN) {
      const grant = await this.prisma.socialAccountAccess.findUnique({
        where: { userId_accountId: { userId: user.sub, accountId: conversation.socialAccountId } },
      });
      if (!grant?.canView) throw new ForbiddenException("You do not have access to this account's conversations");
    }
    return conversation;
  }

  // ---------------------------------------------------------------------
  // Conversations
  // ---------------------------------------------------------------------

  async listConversations(user: JwtClaims, query: ListConversationsQuery) {
    const accountIds = await this.viewableAccountIds(user);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.SocialConversationWhereInput = {
      socialAccount: { orgId: user.orgId, ...(query.platform ? { platform: query.platform } : {}) },
      ...(accountIds ? { socialAccountId: { in: accountIds } } : {}),
      ...(query.accountId ? { socialAccountId: query.accountId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.unreadOnly ? { unreadCount: { gt: 0 } } : {}),
      ...(query.search?.trim()
        ? {
            OR: [
              { contactName: { contains: query.search, mode: "insensitive" } },
              { contactUsername: { contains: query.search, mode: "insensitive" } },
              { lastMessage: { contains: query.search, mode: "insensitive" } },
              { id: query.search },
              { socialAccount: { username: { contains: query.search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    const [conversations, total] = await Promise.all([
      this.prisma.socialConversation.findMany({
        where,
        orderBy: { lastMessageAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          socialAccount: { select: { id: true, platform: true, username: true, displayName: true, profileImageUrl: true } },
          assignedToUser: { select: { id: true, name: true } },
        },
      }),
      this.prisma.socialConversation.count({ where }),
    ]);

    return { conversations, total, page, pageSize };
  }

  async getConversation(user: JwtClaims, id: string) {
    await this.assertConversationAccess(user, id);
    return this.prisma.socialConversation.findUniqueOrThrow({
      where: { id },
      include: {
        socialAccount: { select: { id: true, platform: true, username: true, displayName: true, profileImageUrl: true } },
        assignedToUser: { select: { id: true, name: true } },
        messages: { orderBy: { sentAt: "asc" } },
        notes: { orderBy: { createdAt: "asc" }, include: { user: { select: { id: true, name: true } } } },
      },
    });
  }

  async updateConversation(user: JwtClaims, id: string, dto: UpdateConversationDto) {
    const conversation = await this.assertConversationAccess(user, id);
    const updated = await this.prisma.socialConversation.update({
      where: { id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        // "" is the explicit unassign signal (see UpdateConversationDto's
        // own docblock) -- undefined means "field wasn't sent, don't touch it".
        ...(dto.assignedToUserId !== undefined ? { assignedToUserId: dto.assignedToUserId || null } : {}),
      },
    });
    this.realtime.emitToOrg(conversation.socialAccount.orgId, "socialInbox.conversationUpdated", { conversationId: id });
    return updated;
  }

  async reply(user: JwtClaims, id: string, dto: ReplyDto) {
    const conversation = await this.assertConversationAccess(user, id);
    const provider = this.registry.for(conversation.socialAccount.platform);
    try {
      await provider.sendMessage(conversation.socialAccount, conversation.externalConversationId, dto.text);
    } catch (err) {
      // Same reasoning as SocialMediaService.initiateConnect's catch: a
      // provider's PlatformNotConfiguredError (or a real send failure) is
      // operator-actionable, not a bug -- must reach the UI as a real
      // message, not AllExceptionsFilter's generic 500.
      throw new BadRequestException((err as Error).message);
    }
    const { conversationId } = await this.ingest.persistMessage(conversation.socialAccount, {
      externalConversationId: conversation.externalConversationId,
      externalMessageId: `outbound-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      fromUs: true,
      messageText: dto.text,
      sentAt: new Date(),
    });
    return { sent: true, conversationId };
  }

  // ---------------------------------------------------------------------
  // Internal notes — never sent to the platform, never rendered inside the
  // message thread (enforced by living in a separate table entirely).
  // ---------------------------------------------------------------------

  async createNote(user: JwtClaims, conversationId: string, dto: CreateNoteDto) {
    await this.assertConversationAccess(user, conversationId);
    return this.prisma.socialInternalNote.create({
      data: { conversationId, userId: user.sub, note: dto.note },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  async updateNote(user: JwtClaims, conversationId: string, noteId: string, dto: UpdateNoteDto) {
    await this.assertConversationAccess(user, conversationId);
    const note = await this.prisma.socialInternalNote.findFirst({ where: { id: noteId, conversationId } });
    if (!note) throw new NotFoundException("Note not found");
    if (user.role !== Role.ADMIN && note.userId !== user.sub) {
      throw new ForbiddenException("You can only edit your own notes");
    }
    return this.prisma.socialInternalNote.update({ where: { id: noteId }, data: { note: dto.note } });
  }

  async deleteNote(user: JwtClaims, conversationId: string, noteId: string) {
    await this.assertConversationAccess(user, conversationId);
    const note = await this.prisma.socialInternalNote.findFirst({ where: { id: noteId, conversationId } });
    if (!note) throw new NotFoundException("Note not found");
    if (user.role !== Role.ADMIN && note.userId !== user.sub) {
      throw new ForbiddenException("You can only delete your own notes");
    }
    await this.prisma.socialInternalNote.delete({ where: { id: noteId } });
    return { deleted: true };
  }

  // ---------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------

  async getStats(user: JwtClaims) {
    const accountIds = await this.viewableAccountIds(user);
    const where: Prisma.SocialConversationWhereInput = {
      socialAccount: { orgId: user.orgId },
      ...(accountIds ? { socialAccountId: { in: accountIds } } : {}),
    };
    const [total, unread, open, pending, closed] = await Promise.all([
      this.prisma.socialConversation.count({ where }),
      this.prisma.socialConversation.count({ where: { ...where, unreadCount: { gt: 0 } } }),
      this.prisma.socialConversation.count({ where: { ...where, status: "OPEN" } }),
      this.prisma.socialConversation.count({ where: { ...where, status: "PENDING" } }),
      this.prisma.socialConversation.count({ where: { ...where, status: "CLOSED" } }),
    ]);
    return { total, unread, open, pending, closed };
  }
}
