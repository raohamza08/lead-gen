import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { JwtClaims, Role } from "@leadgen/types";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { TransactionalEmailService } from "../email/transactional-email.service";
import { LeadsService } from "../leads/leads.service";
import { BulkAction, BulkActionDto } from "./dto/bulk-action.dto";
import { CreateTagDto, UpdateTagDto } from "./dto/create-tag.dto";
import { ComposeEmailDto, ReplyMessageDto } from "./dto/reply-message.dto";

export interface ListMessagesQuery {
  accountId?: string;
  status?: "UNREAD" | "IMPORTANT" | "IGNORED" | "ALL";
  tagIds?: string[];
  sender?: string;
  dateFrom?: string;
  dateTo?: string;
  hasAttachments?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 50;

/**
 * Backs the Email Hub's unified inbox (Part: Email Hub). Message-level, not
 * thread-grouped — the spec's own example table lists individual emails
 * ("Select 10 promotional emails -> Ignore"), so that's the primary listing
 * unit here; InboundEmailThread exists for the conversation/reader view and
 * for "which lead does this belong to," not as the list's grouping.
 */
@Injectable()
export class EmailHubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly transactionalEmail: TransactionalEmailService,
    private readonly leads: LeadsService,
  ) {}

  /** Null means "no restriction" (ADMIN) — every other role is scoped to
   *  exactly the accounts EmailAccountAccess grants them. Absence of a grant
   *  row means no access, not read-only access (Part: User Access &
   *  Permissions). */
  private async accessibleAccountIds(user: JwtClaims): Promise<string[] | null> {
    if (user.role === Role.ADMIN) return null;
    const grants = await this.prisma.emailAccountAccess.findMany({
      where: { userId: user.sub },
      select: { accountId: true },
    });
    return grants.map((g) => g.accountId);
  }

  private async assertAccountAccess(user: JwtClaims, accountId: string, requireReply = false) {
    if (user.role === Role.ADMIN) return;
    const grant = await this.prisma.emailAccountAccess.findUnique({
      where: { userId_accountId: { userId: user.sub, accountId } },
    });
    if (!grant || (requireReply && !grant.canReply)) {
      throw new ForbiddenException(requireReply ? "You cannot reply from this account" : "You do not have access to this account");
    }
  }

  async listAccounts(user: JwtClaims) {
    const accountIds = await this.accessibleAccountIds(user);
    const accounts = await this.prisma.emailAccount.findMany({
      where: {
        orgId: user.orgId,
        inboundSyncEnabled: true,
        ...(accountIds ? { id: { in: accountIds } } : {}),
      },
      select: { id: true, address: true, mailboxLabel: true, displayName: true, provider: true, status: true },
      orderBy: { address: "asc" },
    });

    const unreadCounts = await this.prisma.inboundEmailMessage.groupBy({
      by: ["accountId"],
      where: { accountId: { in: accounts.map((a) => a.id) }, isRead: false, isIgnored: false },
      _count: true,
    });
    const unreadByAccount = new Map(unreadCounts.map((c) => [c.accountId, c._count]));

    return accounts.map((a) => ({ ...a, unreadCount: unreadByAccount.get(a.id) ?? 0 }));
  }

  async listTags(orgId: string) {
    return this.prisma.emailTag.findMany({ where: { orgId }, orderBy: { name: "asc" } });
  }

  async createTag(orgId: string, dto: CreateTagDto) {
    return this.prisma.emailTag.create({ data: { orgId, name: dto.name, color: dto.color ?? undefined } });
  }

  async updateTag(orgId: string, id: string, dto: UpdateTagDto) {
    const existing = await this.prisma.emailTag.findFirst({ where: { id, orgId } });
    if (!existing) throw new NotFoundException("Tag not found");
    return this.prisma.emailTag.update({ where: { id }, data: { name: dto.name, color: dto.color } });
  }

  async deleteTag(orgId: string, id: string) {
    const res = await this.prisma.emailTag.deleteMany({ where: { id, orgId } });
    return { deleted: res.count };
  }

  async listMessages(user: JwtClaims, query: ListMessagesQuery) {
    const accountIds = await this.accessibleAccountIds(user);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    let searchIds: string[] | null = null;
    if (query.search?.trim()) {
      // websearch_to_tsquery understands plain "quoted phrase -exclude" input
      // directly — no need to hand-build tsquery syntax in the DTO/frontend.
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT m.id FROM inbound_email_messages m
        JOIN email_accounts a ON a.id = m.account_id
        WHERE a.org_id = ${user.orgId}
          AND m.search_vector @@ websearch_to_tsquery('english', ${query.search})
        ORDER BY ts_rank(m.search_vector, websearch_to_tsquery('english', ${query.search})) DESC
        LIMIT 500
      `;
      searchIds = rows.map((r) => r.id);
      if (searchIds.length === 0) return { messages: [], total: 0, page, pageSize };
    }

    const where: Prisma.InboundEmailMessageWhereInput = {
      account: { orgId: user.orgId },
      ...(accountIds ? { accountId: { in: accountIds } } : {}),
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.status === "UNREAD" ? { isRead: false, isIgnored: false } : {}),
      ...(query.status === "IMPORTANT" ? { isImportant: true, isIgnored: false } : {}),
      ...(query.status === "IGNORED" ? { isIgnored: true } : {}),
      ...(query.status === undefined || query.status === "ALL" ? { isIgnored: false } : {}),
      ...(query.tagIds?.length ? { tags: { some: { tagId: { in: query.tagIds } } } } : {}),
      ...(query.sender ? { fromEmail: { contains: query.sender, mode: "insensitive" } } : {}),
      ...(query.hasAttachments !== undefined ? { hasAttachments: query.hasAttachments } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            receivedAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
      ...(searchIds ? { id: { in: searchIds } } : {}),
    };

    const [messages, total] = await Promise.all([
      this.prisma.inboundEmailMessage.findMany({
        where,
        orderBy: searchIds ? undefined : { receivedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          account: { select: { id: true, address: true, mailboxLabel: true } },
          thread: { select: { id: true, leadId: true } },
          tags: { include: { tag: true } },
        },
      }),
      this.prisma.inboundEmailMessage.count({ where }),
    ]);

    // Raw search already ranked by relevance; findMany's `where: id IN (...)`
    // doesn't preserve that order, so restore it here rather than losing the
    // ranking the query paid for.
    if (searchIds) {
      const rank = new Map(searchIds.map((id, i) => [id, i]));
      messages.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    }

    return { messages, total, page, pageSize };
  }

  async getThread(user: JwtClaims, threadId: string) {
    const thread = await this.prisma.inboundEmailThread.findFirst({
      where: { id: threadId, orgId: user.orgId },
      include: {
        account: { select: { id: true, address: true, mailboxLabel: true } },
        lead: { select: { id: true, companyName: true } },
        messages: {
          orderBy: { receivedAt: "asc" },
          include: { tags: { include: { tag: true } } },
        },
      },
    });
    if (!thread) throw new NotFoundException("Thread not found");
    await this.assertAccountAccess(user, thread.accountId);
    return thread;
  }

  async bulkAction(user: JwtClaims, dto: BulkActionDto) {
    const messages = await this.prisma.inboundEmailMessage.findMany({
      where: { id: { in: dto.messageIds }, account: { orgId: user.orgId } },
      select: { id: true, accountId: true },
    });
    const accountIds = await this.accessibleAccountIds(user);
    const allowed = messages.filter((m) => !accountIds || accountIds.includes(m.accountId));
    if (allowed.length === 0) return { updated: 0 };
    const ids = allowed.map((m) => m.id);

    switch (dto.action) {
      case BulkAction.READ:
        await this.prisma.inboundEmailMessage.updateMany({ where: { id: { in: ids } }, data: { isRead: true } });
        break;
      case BulkAction.UNREAD:
        await this.prisma.inboundEmailMessage.updateMany({ where: { id: { in: ids } }, data: { isRead: false } });
        break;
      case BulkAction.IMPORTANT:
        await this.prisma.inboundEmailMessage.updateMany({ where: { id: { in: ids } }, data: { isImportant: true } });
        break;
      case BulkAction.UNIMPORTANT:
        await this.prisma.inboundEmailMessage.updateMany({ where: { id: { in: ids } }, data: { isImportant: false } });
        break;
      case BulkAction.IGNORE:
        // Filter view only — never touches the real mailbox (Part:
        // Ignore/Noise Management). No IMAP call happens here at all.
        await this.prisma.inboundEmailMessage.updateMany({ where: { id: { in: ids } }, data: { isIgnored: true } });
        break;
      case BulkAction.UNIGNORE:
        await this.prisma.inboundEmailMessage.updateMany({ where: { id: { in: ids } }, data: { isIgnored: false } });
        break;
      case BulkAction.DELETE:
        // Removes the InboundEmailMessage row (our copy) only — the spec is
        // explicit that this must never touch the real mailbox unless
        // requested, and IMAP deletion isn't wired up in V1 at all.
        await this.prisma.inboundEmailMessage.deleteMany({ where: { id: { in: ids } } });
        break;
      case BulkAction.ADD_TAG:
      case BulkAction.REMOVE_TAG: {
        if (!dto.tagId) throw new BadRequestException("tagId is required for ADD_TAG/REMOVE_TAG");
        const tag = await this.prisma.emailTag.findFirst({ where: { id: dto.tagId, orgId: user.orgId } });
        if (!tag) throw new NotFoundException("Tag not found");
        if (dto.action === BulkAction.ADD_TAG) {
          await this.prisma.inboundEmailMessageTag.createMany({
            data: ids.map((messageId) => ({ messageId, tagId: dto.tagId! })),
            skipDuplicates: true,
          });
        } else {
          await this.prisma.inboundEmailMessageTag.deleteMany({
            where: { messageId: { in: ids }, tagId: dto.tagId },
          });
        }
        break;
      }
    }

    this.realtime.emitToOrg(user.orgId, "emailHub.messagesUpdated", { messageIds: ids, action: dto.action });
    return { updated: ids.length };
  }

  async reply(user: JwtClaims, messageId: string, dto: ReplyMessageDto) {
    const original = await this.prisma.inboundEmailMessage.findFirst({
      where: { id: messageId, account: { orgId: user.orgId } },
      include: { account: true },
    });
    if (!original) throw new NotFoundException("Message not found");
    await this.assertAccountAccess(user, original.accountId, true);

    const to = original.fromEmail;
    const cc = dto.replyAll ? original.ccEmails.filter((e) => e !== original.account.address) : [];
    const subject = /^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`;

    const result = await this.transactionalEmail.sendFromAccount(original.account, {
      toAddress: to,
      subject,
      bodyHtml: dto.bodyHtml,
      headers: original.messageIdHeader
        ? { "In-Reply-To": original.messageIdHeader, References: original.messageIdHeader }
        : undefined,
    });

    // cc isn't part of OutboundEmail today (single-recipient sends only,
    // matching the existing outreach send path) — logged, not silently
    // dropped, so "Reply All" not actually CC'ing anyone is visible rather
    // than a silent gap. A real fix belongs in OutboundEmail/the providers,
    // out of scope for this pass.
    return { sent: true, providerMessageId: result.providerMessageId, ccNotSent: cc };
  }

  async compose(user: JwtClaims, dto: ComposeEmailDto) {
    const account = await this.prisma.emailAccount.findFirst({
      where: { id: dto.accountId, orgId: user.orgId },
    });
    if (!account) throw new NotFoundException("Account not found");
    await this.assertAccountAccess(user, account.id, true);

    const result = await this.transactionalEmail.sendFromAccount(account, {
      toAddress: dto.to[0],
      subject: dto.subject,
      bodyHtml: dto.bodyHtml,
    });
    return { sent: true, providerMessageId: result.providerMessageId };
  }

  /**
   * Links a thread to an existing lead if the sender matches one
   * (LeadsService.findLeadByContact — same identities as the platform's
   * own duplicate detection), otherwise creates one. Never creates a
   * second lead for a person already in the system (Part: Lead
   * Integration's explicit requirement).
   */
  async addToLead(user: JwtClaims, threadId: string) {
    const thread = await this.prisma.inboundEmailThread.findFirst({
      where: { id: threadId, orgId: user.orgId },
      include: { messages: { orderBy: { receivedAt: "asc" }, take: 1 } },
    });
    if (!thread) throw new NotFoundException("Thread not found");
    await this.assertAccountAccess(user, thread.accountId);
    if (thread.leadId) return this.prisma.lead.findUnique({ where: { id: thread.leadId } });

    const firstMessage = thread.messages[0];
    if (!firstMessage) throw new BadRequestException("Thread has no messages");

    const domain = firstMessage.fromEmail.split("@")[1];
    const companyGuess = firstMessage.fromName || domain || firstMessage.fromEmail;

    let lead = await this.leads.findLeadByContact(user.orgId, {
      email: firstMessage.fromEmail,
      companyName: companyGuess,
    });

    if (!lead) {
      const created = await this.leads.createManual(user.orgId, {
        companyName: companyGuess,
        contactName: firstMessage.fromName || undefined,
        email: firstMessage.fromEmail,
        notes: `Added from Email Hub — first message: "${thread.subject}"`,
      });
      if (created.status === "duplicate" || !created.leadId) {
        throw new BadRequestException("Could not create lead — a matching lead already exists");
      }
      lead = await this.prisma.lead.findUniqueOrThrow({ where: { id: created.leadId } });
    }

    await this.prisma.inboundEmailThread.update({ where: { id: thread.id }, data: { leadId: lead.id } });
    return lead;
  }

  async getStats(user: JwtClaims) {
    const accountIds = await this.accessibleAccountIds(user);
    const scope: Prisma.InboundEmailMessageWhereInput = {
      account: { orgId: user.orgId },
      ...(accountIds ? { accountId: { in: accountIds } } : {}),
    };
    const since = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [connectedAccounts, unread, important, receivedToday, receivedThisWeek, leadsFromEmail, ignored] =
      await Promise.all([
        this.prisma.emailAccount.count({
          where: { orgId: user.orgId, inboundSyncEnabled: true, ...(accountIds ? { id: { in: accountIds } } : {}) },
        }),
        this.prisma.inboundEmailMessage.count({ where: { ...scope, isRead: false, isIgnored: false } }),
        this.prisma.inboundEmailMessage.count({ where: { ...scope, isImportant: true, isIgnored: false } }),
        this.prisma.inboundEmailMessage.count({ where: { ...scope, receivedAt: { gte: since(1) } } }),
        this.prisma.inboundEmailMessage.count({ where: { ...scope, receivedAt: { gte: since(7) } } }),
        this.prisma.inboundEmailThread.count({
          where: { orgId: user.orgId, leadId: { not: null }, ...(accountIds ? { accountId: { in: accountIds } } : {}) },
        }),
        this.prisma.inboundEmailMessage.count({ where: { ...scope, isIgnored: true } }),
      ]);

    return { connectedAccounts, unread, important, receivedToday, receivedThisWeek, leadsFromEmail, ignored };
  }
}
