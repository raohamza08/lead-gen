import { Injectable } from "@nestjs/common";
import { Prisma, PipelineStage, LeadSourceLayer } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { DashboardRangeQuery, resolveDashboardRange, percentDelta, safeRate } from "./dashboard-center.util";

/** Real engagement occurred — a reply came in or further (Part: Dashboard
 *  Center, 2026-09-30). There is no "qualified" boolean/stage anywhere in
 *  the schema, so this is a documented definition over real stage data, not
 *  a fabricated count — every dashboard surface using this labels it as
 *  such rather than implying it's a distinct tracked field. */
const QUALIFIED_STAGES: PipelineStage[] = [
  "REPLIED", "MEETING_BOOKED", "PROPOSAL_SENT", "NEGOTIATION", "WON", "CLIENT_ONBOARDING",
];
const CONVERTED_STAGES: PipelineStage[] = ["WON", "CLIENT_ONBOARDING"];
const LOST_STAGES: PipelineStage[] = ["LOST"];

export interface LeadsDashboardQuery extends DashboardRangeQuery {
  ownerId?: string;
  nicheId?: string;
  campaignId?: string;
  sourceLayer?: string;
}

@Injectable()
export class LeadsDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  private baseWhere(orgId: string, query: LeadsDashboardQuery): Prisma.LeadWhereInput {
    return {
      orgId,
      uploadedByUserId: query.ownerId || undefined,
      filterId: query.nicheId || undefined,
      campaignId: query.campaignId || undefined,
      sourceLayer: (query.sourceLayer as LeadSourceLayer) || undefined,
    };
  }

  async getKpis(orgId: string, query: LeadsDashboardQuery) {
    const { current, previous } = resolveDashboardRange(query);
    const where = this.baseWhere(orgId, query);

    const countInRange = (from: Date, to: Date) => this.prisma.lead.count({ where: { ...where, createdAt: { gte: from, lte: to } } });

    const [
      totalLeads,
      newLeads,
      previousNewLeads,
      qualified,
      converted,
      lost,
      duplicates,
      withoutOwner,
      withoutNiche,
      withoutPipeline,
    ] = await Promise.all([
      this.prisma.lead.count({ where }),
      countInRange(current.from, current.to),
      previous ? countInRange(previous.from, previous.to) : Promise.resolve(undefined),
      this.prisma.lead.count({ where: { ...where, pipelineState: { stage: { in: QUALIFIED_STAGES } } } }),
      this.prisma.lead.count({ where: { ...where, pipelineState: { stage: { in: CONVERTED_STAGES } } } }),
      this.prisma.lead.count({ where: { ...where, pipelineState: { stage: { in: LOST_STAGES } } } }),
      this.prisma.lead.count({ where: { ...where, possibleDuplicate: true } }),
      this.prisma.lead.count({ where: { ...where, uploadedByUserId: null } }),
      this.prisma.lead.count({ where: { ...where, filterId: null } }),
      this.prisma.lead.count({ where: { ...where, pipelineState: null } }),
    ]);

    const active = totalLeads - converted - lost;

    return {
      range: { from: current.from, to: current.to },
      compareRange: previous ? { from: previous.from, to: previous.to } : null,
      totalLeads,
      newLeads,
      newLeadsDeltaPct: previous ? percentDelta(newLeads, previousNewLeads) : null,
      qualified,
      unqualified: totalLeads - qualified,
      active,
      converted,
      lost,
      conversionRate: safeRate(converted, totalLeads),
      duplicates,
      withoutOwner,
      withoutNiche,
      withoutPipeline,
    };
  }

  async getSourceBreakdown(orgId: string, query: LeadsDashboardQuery) {
    const { current } = resolveDashboardRange(query);
    const where = { ...this.baseWhere(orgId, query), createdAt: { gte: current.from, lte: current.to } };
    const rows = await this.prisma.lead.groupBy({ by: ["sourceLayer"], where, _count: { _all: true } });
    const total = rows.reduce((s, r) => s + r._count._all, 0);
    return rows
      .map((r) => ({ source: r.sourceLayer, count: r._count._all, percentage: safeRate(r._count._all, total) }))
      .sort((a, b) => b.count - a.count);
  }

  /** Real niches only -- `Lead.filterId` is a genuine `NicheFilter` relation,
   *  not free text, so this is never a guessed grouping (Part: Dashboard
   *  Center gap-analysis confirmed this explicitly). Leads with no
   *  filterId are reported separately as "unattributed" rather than
   *  silently dropped from the total. */
  async getNicheBreakdown(orgId: string, query: LeadsDashboardQuery) {
    const { current } = resolveDashboardRange(query);
    const where = { ...this.baseWhere(orgId, query), createdAt: { gte: current.from, lte: current.to } };

    const leads = await this.prisma.lead.findMany({
      where,
      select: { filterId: true, filter: { select: { niche: true } }, pipelineState: { select: { stage: true } } },
    });

    const byNiche = new Map<string, { niche: string; total: number; qualified: number; converted: number }>();
    for (const lead of leads) {
      const key = lead.filterId ?? "__none__";
      const label = lead.filter?.niche ?? "Unattributed";
      const bucket = byNiche.get(key) ?? { niche: label, total: 0, qualified: 0, converted: 0 };
      bucket.total += 1;
      const stage = lead.pipelineState?.stage;
      if (stage && QUALIFIED_STAGES.includes(stage)) bucket.qualified += 1;
      if (stage && CONVERTED_STAGES.includes(stage)) bucket.converted += 1;
      byNiche.set(key, bucket);
    }

    return [...byNiche.values()]
      .map((b) => ({ ...b, conversionRate: safeRate(b.converted, b.total) }))
      .sort((a, b) => b.total - a.total);
  }

  /** The "who added what, when" table the spec's Lead Addition Audit section
   *  asks for -- every row links back to the existing /leads/:id detail
   *  page rather than a new drill-down view, since that page already shows
   *  everything about one lead. */
  async getAdditionAudit(orgId: string, query: LeadsDashboardQuery & { page?: number; pageSize?: number; search?: string }) {
    const { current } = resolveDashboardRange(query);
    const where: Prisma.LeadWhereInput = {
      ...this.baseWhere(orgId, query),
      createdAt: { gte: current.from, lte: current.to },
      ...(query.search
        ? { OR: [{ companyName: { contains: query.search, mode: "insensitive" } }, { email: { contains: query.search, mode: "insensitive" } }] }
        : {}),
    };

    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = query.pageSize && query.pageSize > 0 ? query.pageSize : 25;

    const [rows, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        select: {
          id: true,
          companyName: true,
          email: true,
          createdAt: true,
          sourceLayer: true,
          uploadedByUser: { select: { id: true, name: true } },
          filter: { select: { niche: true } },
          campaign: { select: { name: true } },
          pipelineState: { select: { stage: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return {
      rows: rows.map((r) => ({
        id: r.id,
        companyName: r.companyName,
        email: r.email,
        createdAt: r.createdAt,
        source: r.sourceLayer,
        addedBy: r.uploadedByUser?.name ?? null,
        niche: r.filter?.niche ?? null,
        campaign: r.campaign?.name ?? null,
        stage: r.pipelineState?.stage ?? "LEAD_ROOM",
      })),
      total,
      page,
      pageSize,
    };
  }
}
