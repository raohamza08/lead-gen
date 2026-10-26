import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConversationStatus, Prisma, SocialPlatform } from "@prisma/client";
import { JwtClaims, Role } from "@leadgen/types";
import { PrismaService } from "../common/prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { UserAccessCacheService } from "../common/access/user-access-cache.service";
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
    private readonly userAccess: UserAccessCacheService,
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
              // Matches a word/phrase anywhere in the conversation, not
              // just its cached latest-message preview (Part: WhatsApp
              // Team Inbox search, 2026-10-26, explicit user request --
              // "should search properly" with message content, not just
              // the last message).
              { messages: { some: { messageText: { contains: query.search, mode: "insensitive" } } } },
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

  /** Opening a conversation marks it read (Part: Social Inbox removal /
   *  per-module messaging follow-up, 2026-10-21, explicit user request —
   *  "the badge icon didnt disaapear when i open the chat") — unreadCount
   *  was only ever set, never cleared, anywhere in this service; the nav
   *  badge and this page's own list both read the same column, so neither
   *  could ever clear on its own. Emits the same conversationUpdated event
   *  updateConversation already does, so the sidebar badge and any other
   *  open tab refresh immediately, not just the viewer's own query cache. */
  async getConversation(user: JwtClaims, id: string) {
    const conversation = await this.assertConversationAccess(user, id);
    if (conversation.unreadCount > 0) {
      await this.prisma.socialConversation.update({ where: { id }, data: { unreadCount: 0 } });
      this.realtime.emitToOrg(conversation.socialAccount.orgId, "socialInbox.conversationUpdated", { conversationId: id });
    }
    const result = await this.prisma.socialConversation.findUniqueOrThrow({
      where: { id },
      include: {
        socialAccount: { select: { id: true, platform: true, username: true, displayName: true, profileImageUrl: true } },
        assignedToUser: { select: { id: true, name: true } },
        messages: { orderBy: { sentAt: "asc" } },
        notes: { orderBy: { createdAt: "asc" }, include: { user: { select: { id: true, name: true } } } },
      },
    });
    // WhatsApp Team Inbox sender attribution, primary-admin-only (Part:
    // WhatsApp Team Inbox sender attribution, 2026-10-26, explicit user
    // request -- "only the primary admin can see who sent this message").
    // senderName is stored unconditionally (WhatsAppQrSessionManagerService.
    // sendMessage) so it's never lost; stripped here, at the one place
    // every viewer's read goes through, rather than at write time. Scoped
    // to WHATSAPP_QR specifically, and only on outbound (fromUs) messages
    // -- senderName on an INBOUND WhatsApp group message means something
    // different and already-visible-to-everyone (which group participant
    // actually sent it), not "which of our team members replied"; only the
    // latter is what this restriction is about.
    if (result.socialAccount.platform === "WHATSAPP_QR") {
      const snapshot = await this.userAccess.get(user.sub);
      if (!snapshot?.isPrimaryAdmin) {
        result.messages = result.messages.map((m) => (m.fromUs && m.senderName ? { ...m, senderName: null } : m));
      }
    }
    return result;
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
        // Locks the name against SocialInboxIngestService.persistMessage's
        // own writes (Part: WhatsApp Team Inbox contact rename, 2026-10-26,
        // bug fix) -- clearing it back to empty deliberately un-locks it,
        // same as never having set it.
        ...(dto.contactName !== undefined
          ? { contactName: dto.contactName.trim() || null, contactNameLocked: Boolean(dto.contactName.trim()) }
          : {}),
      },
    });
    this.realtime.emitToOrg(conversation.socialAccount.orgId, "socialInbox.conversationUpdated", { conversationId: id });
    return updated;
  }

  /** JwtClaims carries no name (Part: WhatsApp Team Inbox sender
   *  attribution, 2026-10-26) -- only WhatsAppQrProvider's sendMessage
   *  actually uses this, but it's cheap and harmless for every other
   *  provider to just ignore the extra argument. */
  private async senderUserFor(user: JwtClaims): Promise<{ id: string; name: string }> {
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.sub }, select: { name: true } });
    return { id: user.sub, name: record.name };
  }

  async reply(user: JwtClaims, id: string, dto: ReplyDto) {
    const conversation = await this.assertConversationAccess(user, id);
    const provider = this.registry.for(conversation.socialAccount.platform);
    try {
      await provider.sendMessage(conversation.socialAccount, conversation.externalConversationId, dto.text, await this.senderUserFor(user));
    } catch (err) {
      // Same reasoning as SocialMediaService.initiateConnect's catch: a
      // provider's PlatformNotConfiguredError (or a real send failure) is
      // operator-actionable, not a bug -- must reach the UI as a real
      // message, not AllExceptionsFilter's generic 500.
      throw new BadRequestException((err as Error).message);
    }
    // WhatsAppQrSessionManagerService.sendMessage already persisted this
    // send itself, using the real WhatsApp message id (see its own
    // docblock) -- WhatsApp echoes every outbound send back over the same
    // socket, so persisting again here with a synthetic id would create a
    // genuine duplicate row the dedup can't catch (two different ids for
    // the same logical message). Every other platform has no such echo,
    // so they still need this call to record their own send at all.
    if (conversation.socialAccount.platform === "WHATSAPP_QR") {
      return { sent: true, conversationId: conversation.id };
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

  /** Starting a brand-new conversation, not replying to an existing one
   *  (Part: Social Inbox removal / per-module messaging follow-up,
   *  2026-10-21, explicit user request — "add an option for whatsapp to
   *  send a message from here as well"). WhatsApp-only: Facebook/Instagram
   *  Send API messages require a page-scoped participant id only
   *  obtainable once the person has already messaged the page/account
   *  first -- there is no way to cold-message an arbitrary person there,
   *  unlike WhatsApp where the identifier is just their real phone number.
   *  Meta's own 24-hour-window + template-required rule (same one
   *  reply()'s errors already explain on the frontend) applies in full
   *  here too -- a number that has never messaged this business before
   *  will be rejected unless a pre-approved template is used, which isn't
   *  built here yet; that rejection surfaces as a real BadRequestException,
   *  not a silent failure. */
  async startConversation(user: JwtClaims, accountId: string, dto: { to: string; text: string }) {
    const account = await this.prisma.socialAccount.findFirst({ where: { id: accountId, orgId: user.orgId } });
    if (!account) throw new NotFoundException("Social account not found");
    if (account.platform !== "WHATSAPP" && account.platform !== "WHATSAPP_QR") {
      throw new BadRequestException("Starting a new conversation from here is only supported for WhatsApp.");
    }
    if (user.role !== Role.ADMIN) {
      const grant = await this.prisma.socialAccountAccess.findUnique({
        where: { userId_accountId: { userId: user.sub, accountId: account.id } },
      });
      if (!grant?.canView) throw new ForbiddenException("You do not have access to this account's conversations");
    }

    const to = dto.to.replace(/\D/g, "");
    if (!to) throw new BadRequestException("Enter a valid phone number.");

    const provider = this.registry.for(account.platform);
    try {
      await provider.sendMessage(account, to, dto.text, await this.senderUserFor(user));
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    // Same reasoning as reply() above -- WhatsAppQrSessionManagerService.
    // sendMessage already persisted this send itself (real message id,
    // same externalConversationId "to" used here), so look the row up
    // instead of creating a duplicate with a synthetic id.
    if (account.platform === "WHATSAPP_QR") {
      const conversation = await this.prisma.socialConversation.findUnique({
        where: { socialAccountId_externalConversationId: { socialAccountId: account.id, externalConversationId: to } },
      });
      return { sent: true, conversationId: conversation?.id };
    }
    const { conversationId } = await this.ingest.persistMessage(account, {
      externalConversationId: to,
      contactExternalId: to,
      contactUsername: to,
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
    // Per-platform unread breakdown (Part: Social Inbox removal / per-module
    // messaging, 2026-10-21, explicit user request — give each platform's
    // own nav entry its own badge, not just the group-level `unread` total
    // below). SocialConversation has no own `platform` column (it's on the
    // related socialAccount), hence the relation filter per platform rather
    // than a groupBy.
    const PLATFORMS = ["FACEBOOK", "INSTAGRAM", "LINKEDIN", "WHATSAPP", "WHATSAPP_QR"] as const;
    const [total, unread, open, pending, closed, byPlatformCounts] = await Promise.all([
      this.prisma.socialConversation.count({ where }),
      this.prisma.socialConversation.count({ where: { ...where, unreadCount: { gt: 0 } } }),
      this.prisma.socialConversation.count({ where: { ...where, status: "OPEN" } }),
      this.prisma.socialConversation.count({ where: { ...where, status: "PENDING" } }),
      this.prisma.socialConversation.count({ where: { ...where, status: "CLOSED" } }),
      Promise.all(
        PLATFORMS.map((p) =>
          this.prisma.socialConversation.count({
            where: { ...where, unreadCount: { gt: 0 }, socialAccount: { orgId: user.orgId, platform: p } },
          }),
        ),
      ),
    ]);
    return {
      total,
      unread,
      open,
      pending,
      closed,
      byPlatform: Object.fromEntries(PLATFORMS.map((p, i) => [p, byPlatformCounts[i]])),
    };
  }
}
