import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { JwtClaims, LeadSourceLayer, Role } from "@leadgen/types";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { CacheService } from "../common/cache/cache.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { TransactionalEmailService } from "../email/transactional-email.service";
import { LeadsService } from "../leads/leads.service";
import { BulkAction, BulkActionDto, IgnoreScope } from "./dto/bulk-action.dto";
import { CreateTagDto, UpdateTagDto } from "./dto/create-tag.dto";
import { ComposeEmailDto, ReplyMessageDto } from "./dto/reply-message.dto";
import { ImapReaderProvider } from "./readers/imap-reader.provider";
import { apiPublicUrl } from "../common/api-url";

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

  /** Powers the Ignored view's per-sender/per-domain sub-tabs and the rule
   *  management list (Part: Ignore/Noise Management, extended; domain scope
   *  + rule metadata added Part: Lead Upload Analytics / Email Performance /
   *  Ignore Groups, 2026-09-01) — every muted sender/domain (EmailHubService.
   *  ignoreSender's IGNORE path) alongside how many of their messages are
   *  actually sitting in Ignored right now and who/when muted them, so the
   *  UI can group and manage them instead of one flat list. */
  async listIgnoredSenders(user: JwtClaims) {
    const rules = await this.prisma.ignoredSender.findMany({
      where: { orgId: user.orgId },
      include: { createdByUser: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    if (rules.length === 0) return [];

    // One count query per rule rather than a single groupBy — a DOMAIN
    // rule's count is a `contains`/suffix match, not an exact groupBy key,
    // so the two rule types can't share one grouped query.
    const counts = await Promise.all(
      rules.map((r) =>
        this.prisma.inboundEmailMessage.count({
          where: {
            account: { orgId: user.orgId },
            folder: "INBOX",
            isIgnored: true,
            fromEmail:
              r.ruleType === "DOMAIN" ? { endsWith: `@${r.senderDomain}`, mode: "insensitive" } : { equals: r.fromEmail ?? undefined, mode: "insensitive" },
          },
        }),
      ),
    );

    return rules.map((r, i) => ({
      id: r.id,
      ruleType: r.ruleType,
      fromEmail: r.fromEmail,
      senderDomain: r.senderDomain,
      createdAt: r.createdAt,
      createdByUserId: r.createdByUserId,
      createdByName: r.createdByUser?.name ?? null,
      count: counts[i],
    }));
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

  /** "Track email" results (Part: Email Hub open-tracking visibility,
   *  2026-09-02) — HubEmailOpenTracking rows were written on every send with
   *  trackOpen checked (see withTrackingPixel below) and updated by
   *  TrackingController.trackHubOpen on every pixel fetch, but nothing ever
   *  read them back — a user who checked "Track email" had no way to see
   *  the result short of the real-time "Email Opened" notification, which
   *  only fires for a *verified* open (past the 3-minute anti-prefetch
   *  window). `openedAt` (set on the very first raw pixel fetch, verified
   *  or not) is returned too, since for a Gmail recipient specifically the
   *  raw signal is often the only one that will ever exist — Gmail proxies
   *  and caches images server-side, typically fetching the pixel once,
   *  near-instantly, regardless of whether a human ever opens the message,
   *  and a genuine later human open is then served from that cache without
   *  hitting this pixel again. That's a real, structural limit of pixel
   *  tracking against Gmail, not a bug — surfacing the raw timestamp
   *  honestly (labeled as such) is more useful than staying silent. */
  async listTrackedEmails(orgId: string) {
    return this.prisma.hubEmailOpenTracking.findMany({
      where: { orgId },
      orderBy: { sentAt: "desc" },
      take: 100,
    });
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
        // `select`, not `include` (Part: performance audit, 2026-09-02) —
        // `include` returned every scalar column on every row of every page,
        // notably the full `bodyHtml` (markup, styling, tracking pixels,
        // signatures — routinely several times the size of the plain-text
        // body) and the `attachments` JSON blob, for a list view that only
        // ever renders a sender/subject/120-char bodyText preview/timestamp/
        // flags row. Full body stays available exactly where it's actually
        // read — the thread detail fetch below — unaffected by this.
        select: {
          id: true, threadId: true, accountId: true,
          fromName: true, fromEmail: true, toEmails: true,
          folder: true, subject: true, bodyText: true, receivedAt: true,
          isRead: true, isImportant: true, isIgnored: true, hasAttachments: true,
          suggestedCategory: true, aiSuggestedAction: true,
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
        // `select`, not `include` (Part: Email Hub reading-pane performance,
        // 2026-09-02) — the same over-fetch pattern already fixed on
        // listMessages, just never applied here: `include` pulled every
        // scalar column of every message in the thread, notably
        // `attachments`/`ccEmails`/`bccEmails`/`messageIdHeader`/
        // `providerMessageId`/`inReplyTo`/`references`, none of which
        // message-detail-panel.tsx's own ThreadMessage interface reads — for
        // a long thread this meant a genuinely large, slow payload just to
        // open a single email. Full body (`bodyHtml`/`bodyText`) stays,
        // since the reading pane does render it, for every message, unlike
        // the list view.
        messages: {
          orderBy: { receivedAt: "asc" },
          select: {
            id: true, fromName: true, fromEmail: true, toEmails: true, ccEmails: true,
            subject: true, bodyHtml: true, bodyText: true, receivedAt: true,
            isImportant: true, isIgnored: true, hasAttachments: true, attachments: true,
            suggestedCategory: true, aiSuggestedAction: true, folder: true,
            tags: { include: { tag: true } },
          },
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
        const senders = Array.from(new Set(allowed.map((m) => m.fromEmail)));
        await this.ignoreSenders(user.orgId, user.sub, senders, dto.ignoreScope ?? IgnoreScope.SENDER);
        break;
      }
      case BulkAction.UNIGNORE: {
        await this.prisma.inboundEmailMessage.updateMany({ where: { id: { in: ids } }, data: { isIgnored: false } });
        // Symmetric with IGNORE above: un-ignoring un-mutes whatever rule(s)
        // actually match the selected messages' senders — a SENDER rule on
        // the exact address, or a DOMAIN rule covering it — regardless of
        // which scope created them, so their next email doesn't just land
        // back in Ignored via the sync worker's pre-ignore check a moment later.
        const senders = Array.from(new Set(allowed.map((m) => m.fromEmail)));
        await this.unignoreByFromEmails(user.orgId, senders);
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

  /**
   * Mutes a sender or their whole domain (Part: Ignore/Noise Management,
   * extended; domain scope added Part: Lead Upload Analytics / Email
   * Performance / Ignore Groups, 2026-09-01) — creates the rule(s) and
   * retroactively re-classifies every existing message that already matches
   * into Ignored, same as the original sender-only behavior. Future mail is
   * caught by EmailHubSyncWorker's pre-ignore check.
   */
  private async ignoreSenders(orgId: string, userId: string, fromEmails: string[], scope: IgnoreScope) {
    if (fromEmails.length === 0) return;

    if (scope === IgnoreScope.DOMAIN) {
      const domains = Array.from(new Set(fromEmails.map((e) => e.split("@")[1]).filter((d): d is string => !!d)));
      if (domains.length === 0) return;
      await this.prisma.ignoredSender.createMany({
        data: domains.map((senderDomain) => ({ orgId, ruleType: "DOMAIN", senderDomain, createdByUserId: userId })),
        skipDuplicates: true,
      });
      await this.prisma.inboundEmailMessage.updateMany({
        where: { account: { orgId }, OR: domains.map((d) => ({ fromEmail: { endsWith: `@${d}`, mode: "insensitive" as const } })) },
        data: { isIgnored: true },
      });
      return;
    }

    await this.prisma.ignoredSender.createMany({
      data: fromEmails.map((fromEmail) => ({ orgId, ruleType: "SENDER" as const, fromEmail, createdByUserId: userId })),
      skipDuplicates: true,
    });
    await this.prisma.inboundEmailMessage.updateMany({
      where: { account: { orgId }, fromEmail: { in: fromEmails } },
      data: { isIgnored: true },
    });
  }

  /** Finds every SENDER/DOMAIN rule that currently matches any of the given
   *  addresses and reverses them all (Part: Ignore Groups, 2026-09-01). */
  private async unignoreByFromEmails(orgId: string, fromEmails: string[]) {
    if (fromEmails.length === 0) return;
    const domains = Array.from(new Set(fromEmails.map((e) => e.split("@")[1]).filter((d): d is string => !!d)));
    const rules = await this.prisma.ignoredSender.findMany({
      where: {
        orgId,
        OR: [
          { ruleType: "SENDER", fromEmail: { in: fromEmails } },
          ...(domains.length > 0 ? [{ ruleType: "DOMAIN" as const, senderDomain: { in: domains } }] : []),
        ],
      },
    });
    await this.unignoreRules(orgId, rules);
  }

  /** Deletes the given rules and un-flags every message any of them
   *  matched — never deletes the messages themselves (Part: Ignore Groups,
   *  2026-09-01 — "do not delete historical emails, only reclassify"). */
  private async unignoreRules(
    orgId: string,
    rules: { id: string; ruleType: string; fromEmail: string | null; senderDomain: string | null }[],
  ) {
    if (rules.length === 0) return;
    await this.prisma.ignoredSender.deleteMany({ where: { id: { in: rules.map((r) => r.id) } } });

    const senderEmails = rules.filter((r) => r.ruleType === "SENDER" && r.fromEmail).map((r) => r.fromEmail as string);
    const domains = rules.filter((r) => r.ruleType === "DOMAIN" && r.senderDomain).map((r) => r.senderDomain as string);
    const or: Prisma.InboundEmailMessageWhereInput[] = [];
    if (senderEmails.length > 0) or.push({ fromEmail: { in: senderEmails } });
    for (const domain of domains) or.push({ fromEmail: { endsWith: `@${domain}`, mode: "insensitive" } });
    if (or.length === 0) return;

    await this.prisma.inboundEmailMessage.updateMany({
      where: { account: { orgId }, OR: or },
      data: { isIgnored: false },
    });
  }

  /** The Ignore rule-management row's "Unignore" button (Part: Ignore
   *  Groups, 2026-09-01) — targets one specific rule by id, rather than
   *  requiring the caller to reconstruct which messages belong to it. */
  async unignoreRule(user: JwtClaims, ruleId: string) {
    const rule = await this.prisma.ignoredSender.findFirst({ where: { id: ruleId, orgId: user.orgId } });
    if (!rule) throw new NotFoundException("Ignore rule not found");
    await this.unignoreRules(user.orgId, [rule]);
    this.realtime.emitToOrg(user.orgId, "emailHub.messagesUpdated", { messageIds: [], action: "UNIGNORE" });
    return { unignored: true };
  }

  async reply(user: JwtClaims, messageId: string, dto: ReplyMessageDto) {
    const original = await this.prisma.inboundEmailMessage.findFirst({
      where: { id: messageId, account: { orgId: user.orgId } },
      include: { account: true },
    });
    if (!original) throw new NotFoundException("Message not found");
    // Reading the thread only ever required view access to the account it
    // arrived in — that's unaffected by which account actually sends below.
    await this.assertAccountAccess(user, original.accountId, false);
    this.assertAttachmentsWithinLimit(dto.attachments);

    // Send-from override (Part: UI/UX Redesign, 2026-09-02) — defaults to
    // the receiving account, same as before this existed. Threading
    // (In-Reply-To/References below) keys off Message-ID, not sender
    // identity, so sending from a different connected mailbox still
    // threads correctly for the recipient.
    const sendingAccount =
      dto.accountId && dto.accountId !== original.accountId
        ? await this.prisma.emailAccount.findFirst({ where: { id: dto.accountId, orgId: user.orgId } })
        : original.account;
    if (!sendingAccount) throw new NotFoundException("Sending account not found");
    await this.assertAccountAccess(user, sendingAccount.id, true);

    const to = original.fromEmail;
    // Reply-all's auto-CC (everyone else on the original) and any CC the
    // user typed into the composer are both real recipients — merged and
    // de-duped rather than one silently overriding the other.
    const autoCc = dto.replyAll ? original.ccEmails.filter((e) => e !== original.account.address) : [];
    const cc = Array.from(new Set([...autoCc, ...(dto.cc ?? [])]));
    const subject = /^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`;
    const bodyHtml = await this.withTrackingPixel(user.orgId, to, subject, dto.bodyHtml, dto.trackOpen);

    const result = await this.transactionalEmail.sendFromAccount(sendingAccount, {
      toAddress: to,
      cc: cc.length > 0 ? cc : undefined,
      bcc: dto.bcc,
      subject,
      bodyHtml,
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
    const bodyHtml = await this.withTrackingPixel(user.orgId, dto.to.join(", "), dto.subject, dto.bodyHtml, dto.trackOpen);

    const result = await this.transactionalEmail.sendFromAccount(account, {
      toAddress: dto.to.join(", "),
      cc: dto.cc,
      bcc: dto.bcc,
      subject: dto.subject,
      bodyHtml,
      attachments: dto.attachments,
    });
    return { sent: true, providerMessageId: result.providerMessageId };
  }

  /**
   * Appends an open-tracking pixel for Email Hub compose/reply, only when
   * the sender explicitly checked "Track Email" (Part: reliability
   * overhaul, 2026-08-31) — no checkbox, no row, no pixel, so there is no
   * path to a false "opened" signal for an untracked send. Separate from
   * EmailMessage/EmailEvent (see HubEmailOpenTracking's schema docblock).
   * The tracking row is created before the send attempt so its id is ready
   * to embed; if the send then fails, the row is simply never opened —
   * inert, no notification, no cleanup needed.
   */
  private async withTrackingPixel(
    orgId: string, toAddress: string, subject: string, bodyHtml: string, trackOpen?: boolean,
  ): Promise<string> {
    if (!trackOpen) return bodyHtml;
    const row = await this.prisma.hubEmailOpenTracking.create({ data: { orgId, toAddress, subject } });
    const pixel = `<img src="${apiPublicUrl()}/track/open/hub/${row.id}.png" width="1" height="1" alt="" style="display:none" />`;
    return `${bodyHtml}${pixel}`;
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
        // A real human click ("Add to Lead"), same attribution as the
        // "+Add lead" form (Part: Lead Upload Analytics, 2026-09-01).
        user.sub,
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
