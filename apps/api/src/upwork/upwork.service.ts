import { Injectable, NotFoundException } from "@nestjs/common";
import { NotificationCategory, Prisma, UpworkAccountType, UpworkProposalStatus, UpworkProposalType } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { CreateUpworkProposalDto } from "./dto/create-upwork-proposal.dto";
import { UpdateUpworkProposalDto } from "./dto/update-upwork-proposal.dto";
import { QueryUpworkProposalsDto } from "./dto/query-upwork-proposals.dto";
import { UpdateUpworkPicklistsDto } from "./dto/update-upwork-picklists.dto";
import { SetNotifyRecipientsDto } from "./dto/set-notify-recipients.dto";
import { NotificationsService } from "../notifications/notifications.service";

interface UpworkPicklists {
  categories: string[];
  submitters: string[];
  profiles: string[];
}

/**
 * Replaces the team's daily Upwork Proposals Google Form + Sheet (Part:
 * Upwork Proposals, 2026-09-29) — one BIDDING/INVITE-discriminated table
 * instead of two, so reporting never has to union them back together. See
 * schema.prisma's UpworkProposal docblock for the full field mapping back to
 * the original sheet's columns.
 */
@Injectable()
export class UpworkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  create(orgId: string, dto: CreateUpworkProposalDto) {
    const isBidding = dto.type === UpworkProposalType.BIDDING;
    return this.prisma.upworkProposal.create({
      data: {
        orgId,
        type: dto.type,
        profileName: dto.profileName,
        jobCategory: dto.jobCategory,
        jobLink: dto.jobLink,
        coverLetter: dto.coverLetter,
        submittedBy: dto.submittedBy,
        // Bidding-only fields are silently dropped for INVITE rather than
        // rejected — a copy-pasted form value from the wrong tab shouldn't
        // 400, it should just not mean anything for that type.
        connects: isBidding ? dto.connects ?? null : null,
        accountType: isBidding ? dto.accountType ?? null : null,
        clickupTaskId: dto.clickupTaskId,
        clientName: dto.clientName,
      },
    });
  }

  async findAll(orgId: string, query: QueryUpworkProposalsDto) {
    const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize ?? "50", 10) || 50));

    const where: Prisma.UpworkProposalWhereInput = {
      orgId,
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.submittedBy ? { submittedBy: { equals: query.submittedBy, mode: "insensitive" } } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.upworkProposal.count({ where }),
      this.prisma.upworkProposal.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(orgId: string, id: string) {
    const proposal = await this.prisma.upworkProposal.findFirst({ where: { id, orgId } });
    if (!proposal) throw new NotFoundException("Proposal not found");
    return proposal;
  }

  async update(orgId: string, id: string, dto: UpdateUpworkProposalDto) {
    const existing = await this.prisma.upworkProposal.findFirst({ where: { id, orgId } });
    if (!existing) throw new NotFoundException("Proposal not found");
    // Stamps the follow-up timer's start line the moment status first
    // becomes ACCEPTED (Part: Upwork follow-up reminders, 2026-09-30) —
    // only on that specific transition, not on every save while already
    // ACCEPTED, so re-saving an unrelated field (e.g. clientName) never
    // resets the clock.
    const justAccepted = dto.status === UpworkProposalStatus.ACCEPTED && existing.status !== UpworkProposalStatus.ACCEPTED;
    return this.prisma.upworkProposal.update({
      where: { id },
      data: { ...dto, ...(justAccepted ? { acceptedAt: new Date(), lastFollowUpNotifiedAt: null } : {}) },
    });
  }

  /** Admin sets who should be nudged to follow up on this one proposal, and
   *  can optionally fire that nudge immediately instead of waiting for
   *  UpworkFollowUpReminderWorker's next sweep (Part: Upwork follow-up
   *  reminders, 2026-09-30 — "select the person to notify right now or
   *  later"). Recipients replace the previous list wholesale, same pattern
   *  as updatePicklists — the picker always sends the full edited set. */
  async setNotifyRecipients(orgId: string, id: string, dto: SetNotifyRecipientsDto) {
    const existing = await this.prisma.upworkProposal.findFirst({ where: { id, orgId } });
    if (!existing) throw new NotFoundException("Proposal not found");

    const userIds = [...new Set(dto.userIds)];
    const proposal = await this.prisma.upworkProposal.update({
      where: { id },
      data: {
        notifyUserIds: userIds,
        ...(dto.notifyNow ? { lastFollowUpNotifiedAt: new Date() } : {}),
      },
    });

    if (dto.notifyNow && userIds.length > 0) {
      await this.notifications.notify(orgId, {
        category: NotificationCategory.UPWORK,
        type: "UPWORK_INVITE_FOLLOW_UP",
        title: "Follow up on this Upwork invite",
        message: `${proposal.clientName ?? "This client"}'s invite (${proposal.profileName}) needs a follow-up — status hasn't moved since it was accepted.`,
        actionUrl: "/upwork/invite",
        severity: "WARNING",
        entityType: "upworkProposal",
        entityId: proposal.id,
        recipientUserIds: userIds,
      });
    }

    return proposal;
  }

  async remove(orgId: string, id: string) {
    const res = await this.prisma.upworkProposal.deleteMany({ where: { id, orgId } });
    if (res.count === 0) throw new NotFoundException("Proposal not found");
    return { deleted: true };
  }

  /** Job categories / submitter names / profile names a user picks from
   *  when logging a proposal (Part: Upwork picklists, 2026-09-29) — stored
   *  on Organization.settings, same JSON-blob pattern OrganizationService
   *  already uses for branding/automation settings, rather than a new table
   *  for what's just three lists of strings. */
  async getPicklists(orgId: string): Promise<UpworkPicklists> {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
    const settings = (org?.settings as Record<string, unknown>) ?? {};
    const stored = (settings.upworkPicklists as Partial<UpworkPicklists>) ?? {};
    return {
      categories: stored.categories ?? [],
      submitters: stored.submitters ?? [],
      profiles: stored.profiles ?? [],
    };
  }

  /** Admin-only (enforced by the controller's @Roles). Whichever of the
   *  three lists is included in the body replaces that list wholesale — the
   *  admin panel always sends the full edited list, not a diff, so there's
   *  no add/remove race to reconcile server-side. Trimmed, de-duplicated
   *  (case-insensitive), and sorted so the dropdown reads predictably. */
  async updatePicklists(orgId: string, dto: UpdateUpworkPicklistsDto): Promise<UpworkPicklists> {
    const clean = (list?: string[]) => {
      if (!list) return undefined;
      const seen = new Set<string>();
      const out: string[] = [];
      for (const raw of list) {
        const v = raw.trim();
        const key = v.toLowerCase();
        if (!v || seen.has(key)) continue;
        seen.add(key);
        out.push(v);
      }
      return out.sort((a, b) => a.localeCompare(b));
    };

    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
    const settings = { ...((org?.settings as Record<string, unknown>) ?? {}) };
    const existing = (settings.upworkPicklists as Partial<UpworkPicklists>) ?? {};
    const updated: UpworkPicklists = {
      categories: clean(dto.categories) ?? existing.categories ?? [],
      submitters: clean(dto.submitters) ?? existing.submitters ?? [],
      profiles: clean(dto.profiles) ?? existing.profiles ?? [],
    };
    settings.upworkPicklists = updated;
    await this.prisma.organization.update({ where: { id: orgId }, data: { settings: settings as Prisma.InputJsonValue } });
    return updated;
  }

  /**
   * One reporting call for the Upwork dashboard tab — every count comes
   * straight from this one table (no joins needed, unlike the lead/email
   * analytics services), so plain groupBy is enough rather than raw SQL.
   *
   * Training-account bids are excluded from every number here (Part:
   * live-bids-only reporting, 2026-09-29, explicit user request — "I just
   * need the live bidding data"). They're practice/test submissions, not
   * real pipeline, so a Training bid must never count toward totals, status
   * breakdowns, category/submitter/closer tables, or the trend chart — not
   * just excluded from connects. INVITE rows have no accountType at all and
   * are never touched by this filter.
   */
  async getStats(orgId: string) {
    // Applied to every BIDDING-scoped query below via an OR: an INVITE row
    // always counts, a BIDDING row only counts when it's LIVE.
    const liveOnly: Prisma.UpworkProposalWhereInput = {
      OR: [{ type: UpworkProposalType.INVITE }, { type: UpworkProposalType.BIDDING, accountType: UpworkAccountType.LIVE }],
    };

    const [
      byTypeRaw,
      byStatusRaw,
      byCategoryRaw,
      bySubmitterRaw,
      connectsBySubmitterRaw,
      connectsAgg,
      byCloserRaw,
      trendRaw,
    ] = await Promise.all([
      this.prisma.upworkProposal.groupBy({ by: ["type"], where: { orgId, ...liveOnly }, _count: { _all: true } }),
      this.prisma.upworkProposal.groupBy({ by: ["type", "status"], where: { orgId, ...liveOnly }, _count: { _all: true } }),
      this.prisma.upworkProposal.groupBy({
        by: ["jobCategory"],
        where: { orgId, ...liveOnly },
        _count: { _all: true },
        orderBy: { _count: { jobCategory: "desc" } },
        take: 10,
      }),
      this.prisma.upworkProposal.groupBy({ by: ["submittedBy", "type", "status"], where: { orgId, ...liveOnly }, _count: { _all: true } }),
      this.prisma.upworkProposal.groupBy({
        by: ["submittedBy"],
        where: { orgId, type: UpworkProposalType.BIDDING, accountType: UpworkAccountType.LIVE },
        _sum: { connects: true },
        _count: { _all: true },
      }),
      this.prisma.upworkProposal.aggregate({
        where: { orgId, type: UpworkProposalType.BIDDING, accountType: UpworkAccountType.LIVE },
        _sum: { connects: true },
        _count: { _all: true },
      }),
      // "Who closed most projects" — kept separate per type (grouped by
      // closedBy AND type), not merged, so a Bidding closer's record and an
      // Invite closer's record never get summed into one misleading number.
      this.prisma.upworkProposal.groupBy({
        by: ["closedBy", "type", "status"],
        where: { orgId, closedBy: { not: null }, ...liveOnly },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<{ day: Date; type: UpworkProposalType; count: bigint }[]>`
        SELECT date_trunc('day', created_at) AS day, type, COUNT(*) AS count
        FROM upwork_proposals
        WHERE org_id = ${orgId} AND created_at >= NOW() - INTERVAL '30 days'
          AND (type = 'INVITE' OR (type = 'BIDDING' AND account_type = 'LIVE'))
        GROUP BY 1, 2 ORDER BY 1
      `,
    ]);

    const byType = { BIDDING: 0, INVITE: 0 } as Record<UpworkProposalType, number>;
    for (const row of byTypeRaw) byType[row.type] = row._count._all;

    const emptyStatusCounts = (): Record<UpworkProposalStatus, number> => ({
      SUBMITTED: 0, VIEWED: 0, ACCEPTED: 0, IN_DISCUSSION: 0, FOLLOW_UP_1: 0, FOLLOW_UP_2: 0, WON: 0, LOST: 0,
    });
    const byStatus = { BIDDING: emptyStatusCounts(), INVITE: emptyStatusCounts() };
    for (const row of byStatusRaw) byStatus[row.type][row.status] = row._count._all;

    const won = byStatus.BIDDING.WON + byStatus.INVITE.WON;
    const lost = byStatus.BIDDING.LOST + byStatus.INVITE.LOST;
    const closed = won + lost;
    const winRate = closed > 0 ? Math.round((won / closed) * 100) : null;

    // Kept fully split per type rather than one merged table — "how many
    // bids did X do" and "how many invites did X receive" are different
    // questions with different denominators (connects only exist for
    // bidding), so combining them into one row/total was actively misleading.
    type SubmitterRow = { submittedBy: string; total: number; won: number; lost: number; connectsUsed: number };
    const submitterMaps = { BIDDING: new Map<string, SubmitterRow>(), INVITE: new Map<string, SubmitterRow>() };
    const getSubmitter = (type: UpworkProposalType, name: string) =>
      submitterMaps[type].get(name) ?? { submittedBy: name, total: 0, won: 0, lost: 0, connectsUsed: 0 };
    for (const row of bySubmitterRaw) {
      const entry = getSubmitter(row.type, row.submittedBy);
      entry.total += row._count._all;
      if (row.status === UpworkProposalStatus.WON) entry.won += row._count._all;
      if (row.status === UpworkProposalStatus.LOST) entry.lost += row._count._all;
      submitterMaps[row.type].set(row.submittedBy, entry);
    }
    for (const row of connectsBySubmitterRaw) {
      const entry = getSubmitter(UpworkProposalType.BIDDING, row.submittedBy);
      entry.connectsUsed = row._sum.connects ?? 0;
      submitterMaps.BIDDING.set(row.submittedBy, entry);
    }

    type CloserRow = { closedBy: string; won: number; lost: number; other: number };
    const closerMaps = { BIDDING: new Map<string, CloserRow>(), INVITE: new Map<string, CloserRow>() };
    for (const row of byCloserRaw) {
      const name = row.closedBy as string;
      const map = closerMaps[row.type];
      const entry = map.get(name) ?? { closedBy: name, won: 0, lost: 0, other: 0 };
      if (row.status === UpworkProposalStatus.WON) entry.won += row._count._all;
      else if (row.status === UpworkProposalStatus.LOST) entry.lost += row._count._all;
      else entry.other += row._count._all;
      map.set(name, entry);
    }

    const trendByDay = new Map<string, { date: string; bidding: number; invite: number }>();
    for (const row of trendRaw) {
      const date = row.day.toISOString().slice(0, 10);
      const entry = trendByDay.get(date) ?? { date, bidding: 0, invite: 0 };
      if (row.type === UpworkProposalType.BIDDING) entry.bidding += Number(row.count);
      else entry.invite += Number(row.count);
      trendByDay.set(date, entry);
    }

    const connectsUsed = connectsAgg._sum.connects ?? 0;
    const bidsWithConnects = connectsAgg._count._all;

    return {
      total: byType.BIDDING + byType.INVITE,
      byType,
      byStatus,
      won,
      lost,
      winRate,
      connectsUsed,
      avgConnectsPerBid: bidsWithConnects > 0 ? Math.round((connectsUsed / bidsWithConnects) * 10) / 10 : 0,
      byCategory: byCategoryRaw.map((r) => ({ category: r.jobCategory, count: r._count._all })),
      bySubmitter: {
        BIDDING: Array.from(submitterMaps.BIDDING.values()).sort((a, b) => b.total - a.total),
        INVITE: Array.from(submitterMaps.INVITE.values()).sort((a, b) => b.total - a.total),
      },
      byCloser: {
        BIDDING: Array.from(closerMaps.BIDDING.values()).sort((a, b) => b.won - a.won),
        INVITE: Array.from(closerMaps.INVITE.values()).sort((a, b) => b.won - a.won),
      },
      trend: Array.from(trendByDay.values()).sort((a, b) => a.date.localeCompare(b.date)),
    };
  }
}
