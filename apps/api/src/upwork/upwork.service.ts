import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, UpworkProposalStatus, UpworkProposalType } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { CreateUpworkProposalDto } from "./dto/create-upwork-proposal.dto";
import { UpdateUpworkProposalDto } from "./dto/update-upwork-proposal.dto";
import { QueryUpworkProposalsDto } from "./dto/query-upwork-proposals.dto";

/**
 * Replaces the team's daily Upwork Proposals Google Form + Sheet (Part:
 * Upwork Proposals, 2026-09-29) — one BIDDING/INVITE-discriminated table
 * instead of two, so reporting never has to union them back together. See
 * schema.prisma's UpworkProposal docblock for the full field mapping back to
 * the original sheet's columns.
 */
@Injectable()
export class UpworkService {
  constructor(private readonly prisma: PrismaService) {}

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
    return this.prisma.upworkProposal.update({ where: { id }, data: dto });
  }

  async remove(orgId: string, id: string) {
    const res = await this.prisma.upworkProposal.deleteMany({ where: { id, orgId } });
    if (res.count === 0) throw new NotFoundException("Proposal not found");
    return { deleted: true };
  }

  /**
   * One reporting call for the Upwork dashboard tab — every count comes
   * straight from this one table (no joins needed, unlike the lead/email
   * analytics services), so plain groupBy is enough rather than raw SQL.
   */
  async getStats(orgId: string) {
    const [byTypeRaw, byStatusRaw, byCategoryRaw, bySubmitterRaw, connectsAgg, trendRaw] = await Promise.all([
      this.prisma.upworkProposal.groupBy({ by: ["type"], where: { orgId }, _count: { _all: true } }),
      this.prisma.upworkProposal.groupBy({ by: ["type", "status"], where: { orgId }, _count: { _all: true } }),
      this.prisma.upworkProposal.groupBy({
        by: ["jobCategory"],
        where: { orgId },
        _count: { _all: true },
        orderBy: { _count: { jobCategory: "desc" } },
        take: 10,
      }),
      this.prisma.upworkProposal.groupBy({ by: ["submittedBy", "type", "status"], where: { orgId }, _count: { _all: true } }),
      this.prisma.upworkProposal.aggregate({ where: { orgId, type: UpworkProposalType.BIDDING }, _sum: { connects: true } }),
      this.prisma.$queryRaw<{ day: Date; type: UpworkProposalType; count: bigint }[]>`
        SELECT date_trunc('day', created_at) AS day, type, COUNT(*) AS count
        FROM upwork_proposals
        WHERE org_id = ${orgId} AND created_at >= NOW() - INTERVAL '30 days'
        GROUP BY 1, 2 ORDER BY 1
      `,
    ]);

    const byType = { BIDDING: 0, INVITE: 0 } as Record<UpworkProposalType, number>;
    for (const row of byTypeRaw) byType[row.type] = row._count._all;

    const emptyStatusCounts = (): Record<UpworkProposalStatus, number> => ({
      SUBMITTED: 0, IN_DISCUSSION: 0, FOLLOW_UP_1: 0, FOLLOW_UP_2: 0, WON: 0, LOST: 0,
    });
    const byStatus = { BIDDING: emptyStatusCounts(), INVITE: emptyStatusCounts() };
    for (const row of byStatusRaw) byStatus[row.type][row.status] = row._count._all;

    const won = byStatus.BIDDING.WON + byStatus.INVITE.WON;
    const lost = byStatus.BIDDING.LOST + byStatus.INVITE.LOST;
    const closed = won + lost;
    const winRate = closed > 0 ? Math.round((won / closed) * 100) : null;

    const submitterMap = new Map<string, { submittedBy: string; total: number; won: number; lost: number }>();
    for (const row of bySubmitterRaw) {
      const entry = submitterMap.get(row.submittedBy) ?? { submittedBy: row.submittedBy, total: 0, won: 0, lost: 0 };
      entry.total += row._count._all;
      if (row.status === UpworkProposalStatus.WON) entry.won += row._count._all;
      if (row.status === UpworkProposalStatus.LOST) entry.lost += row._count._all;
      submitterMap.set(row.submittedBy, entry);
    }

    const trendByDay = new Map<string, { date: string; bidding: number; invite: number }>();
    for (const row of trendRaw) {
      const date = row.day.toISOString().slice(0, 10);
      const entry = trendByDay.get(date) ?? { date, bidding: 0, invite: 0 };
      if (row.type === UpworkProposalType.BIDDING) entry.bidding += Number(row.count);
      else entry.invite += Number(row.count);
      trendByDay.set(date, entry);
    }

    return {
      total: byType.BIDDING + byType.INVITE,
      byType,
      byStatus,
      won,
      lost,
      winRate,
      connectsUsed: connectsAgg._sum.connects ?? 0,
      byCategory: byCategoryRaw.map((r) => ({ category: r.jobCategory, count: r._count._all })),
      bySubmitter: Array.from(submitterMap.values()).sort((a, b) => b.total - a.total),
      trend: Array.from(trendByDay.values()).sort((a, b) => a.date.localeCompare(b.date)),
    };
  }
}
