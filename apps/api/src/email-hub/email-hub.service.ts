import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { JwtClaims, LeadSourceLayer, Role } from "@leadgen/types";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { CacheService } from "../common/cache/cache.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { TransactionalEmailService } from "../email/transactional-email.service";
import { LeadsService } from "../leads/leads.service";
import { BulkAction, BulkActionDto } from "./dto/bulk-action.dto";
import { CreateTagDto, UpdateTagDto } from "./dto/create-tag.dto";
import { ComposeEmailDto, ReplyMessageDto } from "./dto/reply-message.dto";
import { ImapReaderProvider } from "./readers/imap-reader.provider";

export interface ListMessagesQuery {
  accountId?: string;
  status?: "UNREAD" | "IMPORTANT" | "IGNORED" | "ALL" | "LEADS" | "SENT";
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
    private readonly cache: CacheService,
    private readonly realtime: RealtimeGateway,
    private readonly transactionalEmail: TransactionalEmailService,
    private readonly leads: LeadsService,
    private readonly imapReader: ImapReaderProvider,
  ) {}

  /** listAccounts/getStats are keyed per access scope, not just orgId — a
   *  non-admin only sees the accounts they're granted, and caching an
   *  admin's unrestricted result under the same key would leak it to a
   *  restricted user (or vice versa, show them a stale unrestricted view). */
  private scopeKey(orgId: string, accountIds: string[] | null): string {
    return `${orgId}:${accountIds ? [...accountIds].sort().join(",") : "all"}`;
  }

  /** Best-effort invalidation after a mutation — clears exactly the
   *  requesting user's own scope immediately (so their own action feels
   *  instant), while any other user's differently-scoped cache entry still
   *  expires naturally via the short TTL below. Wiring true multi-scope
   *  invalidation isn't worth the complexity for a stopgap cache. */
  private async invalidateStatsFor(user: JwtClaims) {
    const accountIds = await this.accessibleAccountIds(user);
    const key = this.scopeKey(user.orgId, accountIds);
    await Promise.all([
      this.cache.invalidate(`email-hub:accounts:${key}`),
      this.cache.invalidate(`email-hub:stats:${key}`),
    ]);
  }

  /** Powers the Ignored view's per-sender sub-tabs (Part: Ignore/Noise
   *  Management, extended) — every muted sender (bulkAction's IGNORE path)
   *  alongside how many of their messages are actually sitting in Ignored
   *  right now, so the UI can group them instead of one flat list. */
  async listIgnoredSenders(user: JwtClaims) {
    const senders = await this.prisma.ignoredSender.findMany({
      where: { orgId: user.orgId },
      orderBy: { fromEmail: "asc" },
    });
    if (senders.length === 0) return [];

    const counts = await this.prisma.inboundEmailMessage.groupBy({
      by: ["fromEmail"],
      where: {
        account: { orgId: user.orgId },
        folder: "INBOX",
        isIgnored: true,
        fromEmail: { in: senders.map((s) => s.fromEmail) },
      },
      _count: true,
    });
    const countByEmail = new Map(counts.map((c) => [c.fromEmail, c._count]));

    return senders.map((s) => ({ fromEmail: s.fromEmail, count: countByEmail.get(s.fromEmail) ?? 0 }));
  }

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

  /** Sidebar account list + unread badges — read on every Email Hub page
   *  load. Cached briefly (see CacheService's docblock); bulkAction and
   *  addToLead invalidate this user's own scope immediately so marking
   *  something read doesn't leave a stale badge for the rest of the TTL. */
  async listAccounts(user: JwtClaims) {
    const accountIds = await this.accessibleAccountIds(user);
    return this.cache.getOrSet(`email-hub:accounts:${this.scopeKey(user.orgId, accountIds)}`, 15, () =>
      this.fetchAccounts(user.orgId, accountIds),
    );
  }

  private async fetchAccounts(orgId: string, accountIds: string[] | null) {
    const accounts = await this.prisma.emailAccount.findMany({
      where: {
        orgId,
        inboundSyncEnabled: true,
        ...(accountIds ? { id: { in: accountIds } } : {}),
      },
      select: { id: true, address: true, mailboxLabel: true, displayName: true, provider: true, status: true },
      orderBy: { address: "asc" },
    });

    const unreadCounts = await this.prisma.inboundEmailMessage.groupBy({
      by: ["accountId"],
      // folder: "INBOX" -- a synced Sent message always starts isRead: false
      // (read state is tracked in-app, not from the mailbox's real \Seen
      // flag; see ImapReaderProvider.fetchNew, which never requests IMAP
      // flags), so without this every Sent message would inflate the badge.
      where: { accountId: { in: accounts.map((a) => a.id) }, folder: "INBOX", isRead: false, isIgnored: false },
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
      // Every non-SENT view is implicitly scoped to the INBOX folder — Sent
      // items only ever surface in the SENT view below, never mixed into
      // the general inbox pages now that Sent-folder syncing exists.
      ...(query.status !== "SENT" ? { folder: "INBOX" } : { folder: "SENT" }),
      ...(query.status === "UNREAD" ? { isRead: false, isIgnored: false } : {}),
      ...(query.status === "IMPORTANT" ? { isImportant: true, isIgnored: false } : {}),
      ...(query.status === "IGNORED" ? { isIgnored: true } : {}),
      ...(query.status === undefined || query.status === "ALL" ? { isIgnored: false } : {}),
      // Confirmed (thread already linked to a Lead) or AI-suggested
      // (Part: Lead Room / Smart Email Classification) -- a real server-side
      // filter rather than a client-side slice of the general inbox page, so
      // it composes correctly with pagination instead of only ever showing
      // whatever leads happen to land on whatever page is currently loaded.
      ...(query.status === "LEADS"
        ? { isIgnored: false, OR: [{ thread: { leadId: { not: null } } }, { suggestedCategory: "POSSIBLE_LEAD" }] }
        : {}),
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

  /** On-demand attachment view/download (Part: Email Detail View) — bytes
   *  were never persisted at sync time (InboundEmailMessage.attachments is
   *  metadata only), so opening one re-fetches the source message from the
   *  mailbox and pulls the attachment out fresh. Slower than a DB read, but
   *  correct: no separate blob-storage subsystem to keep in sync, and the
   *  attachment is always exactly what's actually in the mailbox right now. */
  async getAttachment(user: JwtClaims, messageId: string, attachmentIndex: number) {
    const message = await this.prisma.inboundEmailMessage.findFirst({
      where: { id: messageId, account: { orgId: user.orgId } },
      include: { account: true },
    });
    if (!message) throw new NotFoundException("Message not found");
    await this.assertAccountAccess(user, message.accountId);

    const attachment = await this.imapReader.fetchAttachment(
      message.account,
      message.folder,
      message.providerMessageId,
      attachmentIndex,
    );
    if (!attachment) throw new NotFoundException("Attachment not found");
    return attachment;
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
      select: { id: true, accountId: true, fromEmail: true },
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
      case BulkAction.IGNORE: {
        // Filter view only — never touches the real mailbox (Part:
        // Ignore/Noise Management). No IMAP call happens here at all.
        await this.prisma.inboundEmailMessage.updateMany({ where: { id: { in: ids } }, data: { isIgnored: true } });
        // Muting the sender, not just this one message (Part: Ignore/Noise
        // Management, extended) — every other message already in the org
        // from the same address gets swept into Ignored too, and
        // EmailHubSyncWorker pre-ignores anything that arrives from them
        // afterward. Scoped to the org, not the account: a promotional
        // sender emailing one connected mailbox is noise for the whole
        // team, not just that inbox.
        const senders = Array.from(new Set(allowed.map((m) => m.fromEmail)));
        if (senders.length > 0) {
          await this.prisma.ignoredSender.createMany({
            data: senders.map((fromEmail) => ({ orgId: user.orgId, fromEmail })),
            skipDuplicates: true,
          });
          await this.prisma.inboundEmailMessage.updateMany({
            where: { account: { orgId: user.orgId }, fromEmail: { in: senders } },
            data: { isIgnored: true },
          });
        }
        break;
      }
      case BulkAction.UNIGNORE: {
        await this.prisma.inboundEmailMessage.updateMany({ where: { id: { in: ids } }, data: { isIgnored: false } });
        // Symmetric with IGNORE above: un-ignoring un-mutes the sender
        // entirely, so their next email doesn't just land back in Ignored
        // via the sync worker's pre-ignore check a moment later.
        const senders = Array.from(new Set(allowed.map((m) => m.fromEmail)));
        if (senders.length > 0) {
          await this.prisma.ignoredSender.deleteMany({ where: { orgId: user.orgId, fromEmail: { in: senders } } });
          await this.prisma.inboundEmailMessage.updateMany({
            where: { account: { orgId: user.orgId }, fromEmail: { in: senders } },
            data: { isIgnored: false },
          });
        }
        break;
      }
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
    await this.invalidateStatsFor(user);
    return { updated: ids.length };
  }

  async reply(user: JwtClaims, messageId: string, dto: ReplyMessageDto) {
    const original = await this.prisma.inboundEmailMessage.findFirst({
      where: { id: messageId, account: { orgId: user.orgId } },
      include: { account: true },
    });
    if (!original) throw new NotFoundException("Message not found");
    await this.assertAccountAccess(user, original.accountId, true);
    this.assertAttachmentsWithinLimit(dto.attachments);

    const to = original.fromEmail;
    // Reply-all's auto-CC (everyone else on the original) and any CC the
    // user typed into the composer are both real recipients — merged and
    // de-duped rather than one silently overriding the other.
    const autoCc = dto.replyAll ? original.ccEmails.filter((e) => e !== original.account.address) : [];
    const cc = Array.from(new Set([...autoCc, ...(dto.cc ?? [])]));
    const subject = /^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`;

    const result = await this.transactionalEmail.sendFromAccount(original.account, {
      toAddress: to,
      cc: cc.length > 0 ? cc : undefined,
      bcc: dto.bcc,
      subject,
      bodyHtml: dto.bodyHtml,
      headers: original.messageIdHeader
        ? { "In-Reply-To": original.messageIdHeader, References: original.messageIdHeader }
        : undefined,
      attachments: dto.attachments,
    });

    return { sent: true, providerMessageId: result.providerMessageId };
  }

  async compose(user: JwtClaims, dto: ComposeEmailDto) {
    const account = await this.prisma.emailAccount.findFirst({
      where: { id: dto.accountId, orgId: user.orgId },
    });
    if (!account) throw new NotFoundException("Account not found");
    await this.assertAccountAccess(user, account.id, true);
    this.assertAttachmentsWithinLimit(dto.attachments);

    const result = await this.transactionalEmail.sendFromAccount(account, {
      toAddress: dto.to.join(", "),
      cc: dto.cc,
      bcc: dto.bcc,
      subject: dto.subject,
      bodyHtml: dto.bodyHtml,
      attachments: dto.attachments,
    });
    return { sent: true, providerMessageId: result.providerMessageId };
  }

  /** Attachments travel as base64 in the JSON body (never persisted — see
   *  OutboundAttachment's docblock), so this is the only backstop against an
   *  oversized payload; matches the body-parser limit raised in main.ts. */
  private assertAttachmentsWithinLimit(attachments?: { contentBase64: string }[]) {
    if (!attachments?.length) return;
    const totalBytes = attachments.reduce((sum, a) => sum + Buffer.byteLength(a.contentBase64, "base64"), 0);
    const MAX_TOTAL_BYTES = 15 * 1024 * 1024;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new BadRequestException("Attachments exceed the 15 MB total limit");
    }
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
      const created = await this.leads.createManual(
        user.orgId,
        {
          companyName: companyGuess,
          contactName: firstMessage.fromName || undefined,
          email: firstMessage.fromEmail,
          notes: `Added from Email Hub — first message: "${thread.subject}"`,
        },
        LeadSourceLayer.EMAIL,
      );
      if (created.status === "duplicate" || !created.leadId) {
        throw new BadRequestException("Could not create lead — a matching lead already exists");
      }
      lead = await this.prisma.lead.findUniqueOrThrow({ where: { id: created.leadId } });
    }

    await this.prisma.inboundEmailThread.update({ where: { id: thread.id }, data: { leadId: lead.id } });
    await this.invalidateStatsFor(user);
    return lead;
  }

  /** The Email Hub's stat tiles — 8 queries fired in parallel on every page
   *  load. Cached the same way as listAccounts (see its docblock for the
   *  invalidation reasoning). */
  async getStats(user: JwtClaims) {
    const accountIds = await this.accessibleAccountIds(user);
    return this.cache.getOrSet(`email-hub:stats:${this.scopeKey(user.orgId, accountIds)}`, 15, () =>
      this.computeStats(user.orgId, accountIds),
    );
  }

  private async computeStats(orgId: string, accountIds: string[] | null) {
    // folder: "INBOX" -- every tile here (unread/important/received/ignored/
    // possible-leads) is an inbox-triage stat; without this a synced Sent
    // message (always isRead: false, see listAccounts's own note above)
    // would double-count into "unread" and inflate every other tile too.
    const scope: Prisma.InboundEmailMessageWhereInput = {
      account: { orgId },
      folder: "INBOX",
      ...(accountIds ? { accountId: { in: accountIds } } : {}),
    };
    const since = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [connectedAccounts, unread, important, receivedToday, receivedThisWeek, leadsFromEmail, ignored, possibleLeads] =
      await Promise.all([
        this.prisma.emailAccount.count({
          where: { orgId, inboundSyncEnabled: true, ...(accountIds ? { id: { in: accountIds } } : {}) },
        }),
        this.prisma.inboundEmailMessage.count({ where: { ...scope, isRead: false, isIgnored: false } }),
        this.prisma.inboundEmailMessage.count({ where: { ...scope, isImportant: true, isIgnored: false } }),
        this.prisma.inboundEmailMessage.count({ where: { ...scope, receivedAt: { gte: since(1) } } }),
        this.prisma.inboundEmailMessage.count({ where: { ...scope, receivedAt: { gte: since(7) } } }),
        this.prisma.inboundEmailThread.count({
          where: { orgId, leadId: { not: null }, ...(accountIds ? { accountId: { in: accountIds } } : {}) },
        }),
        this.prisma.inboundEmailMessage.count({ where: { ...scope, isIgnored: true } }),
        // Awaiting confirmation (Part: Lead Room) — flagged by the AI classifier
        // but not yet turned into a lead via Add to Lead.
        this.prisma.inboundEmailMessage.count({
          where: { ...scope, suggestedCategory: "POSSIBLE_LEAD", thread: { leadId: null } },
        }),
      ]);

    return { connectedAccounts, unread, important, receivedToday, receivedThisWeek, leadsFromEmail, ignored, possibleLeads };
  }
}
