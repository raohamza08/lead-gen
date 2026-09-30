import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { aggregateInsights, percentDelta } from "./meta-ads-metrics.util";
import { DateRangeQueryDto, ListAdSetsQueryDto, ListAdsQueryDto, ListCampaignsQueryDto, TimeseriesQueryDto } from "./dto/meta-ads.dto";

const DEFAULT_WINDOW_DAYS = 30;

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}
function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

interface Resolved {
  from: Date;
  to: Date;
  compareFrom?: Date;
  compareTo?: Date;
}

/** Resolves the shared from/to (+ optional comparison window) query shape
 *  every Meta Ads read endpoint takes. Defaults to the trailing 30 days,
 *  never "all time" — an empty reporting period must be a real, visible
 *  empty state (Part: Error Handling), not silently widened. When a
 *  comparison is requested without explicit compareFrom/compareTo, the
 *  previous equal-length period immediately preceding `from` is used. */
function resolveRange(query: DateRangeQueryDto): Resolved {
  const now = new Date();
  const to = query.to ? new Date(query.to) : now;
  const from = query.from ? startOfDay(new Date(query.from)) : addDays(startOfDay(now), -DEFAULT_WINDOW_DAYS);

  if (query.compare !== "true") return { from, to };

  if (query.compareFrom && query.compareTo) {
    return { from, to, compareFrom: startOfDay(new Date(query.compareFrom)), compareTo: new Date(query.compareTo) };
  }
  const spanMs = to.getTime() - from.getTime();
  return { from, to, compareFrom: new Date(from.getTime() - spanMs), compareTo: from };
}

@Injectable()
export class MetaAdsAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertAccount(orgId: string, accountId: string) {
    const account = await this.prisma.metaAdAccount.findFirst({ where: { id: accountId, orgId } });
    if (!account) throw new NotFoundException("Meta ad account not found");
    return account;
  }

  private async fetchInsights(accountId: string, from: Date, to: Date, extra: { campaignId?: string; adSetId?: string } = {}) {
    return this.prisma.metaAdInsightDaily.findMany({
      where: {
        adAccountId: accountId,
        date: { gte: from, lte: to },
        ...(extra.campaignId ? { campaignId: extra.campaignId } : {}),
        ...(extra.adSetId ? { adSetId: extra.adSetId } : {}),
      },
    });
  }

  async getOverview(orgId: string, accountId: string, query: DateRangeQueryDto) {
    const account = await this.assertAccount(orgId, accountId);
    const range = resolveRange(query);

    const currentRows = await this.fetchInsights(account.id, range.from, range.to);
    const current = aggregateInsights(currentRows);

    let previous: ReturnType<typeof aggregateInsights> | undefined;
    let deltas: Record<string, number | null> | undefined;
    if (range.compareFrom && range.compareTo) {
      const previousRows = await this.fetchInsights(account.id, range.compareFrom, range.compareTo);
      previous = aggregateInsights(previousRows);
      deltas = {
        spend: percentDelta(current.spend, previous.spend),
        impressions: percentDelta(current.impressions, previous.impressions),
        reach: percentDelta(current.reach, previous.reach),
        clicks: percentDelta(current.clicks, previous.clicks),
        ctr: percentDelta(current.ctr, previous.ctr),
        cpc: percentDelta(current.cpc, previous.cpc),
        cpm: percentDelta(current.cpm, previous.cpm),
        conversions: percentDelta(current.conversions, previous.conversions),
        roas: percentDelta(current.roas, previous.roas),
      };
    }

    return {
      account: {
        id: account.id,
        name: account.name,
        currency: account.currency,
        status: account.status,
        lastSyncAt: account.lastSyncAt,
        lastSyncError: account.lastSyncError,
      },
      range: { from: range.from, to: range.to },
      compareRange: range.compareFrom ? { from: range.compareFrom, to: range.compareTo } : null,
      current,
      previous: previous ?? null,
      deltas: deltas ?? null,
    };
  }

  async getTimeseries(orgId: string, accountId: string, query: TimeseriesQueryDto) {
    const account = await this.assertAccount(orgId, accountId);
    const range = resolveRange(query);
    const rows = await this.fetchInsights(account.id, range.from, range.to, { campaignId: query.campaignId, adSetId: query.adSetId });

    const byDate = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = row.date.toISOString().slice(0, 10);
      const bucket = byDate.get(key) ?? [];
      bucket.push(row);
      byDate.set(key, bucket);
    }

    return [...byDate.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, dayRows]) => ({ date, ...aggregateInsights(dayRows) }));
  }

  private applySortAndPage<T extends Record<string, unknown>>(
    rows: T[],
    sortBy: string | undefined,
    sortDir: string | undefined,
    page: number | undefined,
    pageSize: number | undefined,
  ) {
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortBy) {
      rows.sort((a, b) => {
        const av = a[sortBy] ?? 0;
        const bv = b[sortBy] ?? 0;
        if (typeof av === "string" || typeof bv === "string") return dir * String(av).localeCompare(String(bv));
        return dir * ((av as number) - (bv as number));
      });
    }
    const size = pageSize && pageSize > 0 ? pageSize : 25;
    const pageNum = page && page > 0 ? page : 1;
    const start = (pageNum - 1) * size;
    return { rows: rows.slice(start, start + size), total: rows.length, page: pageNum, pageSize: size };
  }

  async listCampaigns(orgId: string, accountId: string, query: ListCampaignsQueryDto) {
    const account = await this.assertAccount(orgId, accountId);
    const range = resolveRange(query);

    const campaigns = await this.prisma.metaCampaign.findMany({
      where: {
        adAccountId: account.id,
        ...(query.search ? { name: { contains: query.search, mode: "insensitive" } } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.objective ? { objective: query.objective } : {}),
      },
    });
    if (campaigns.length === 0) return { rows: [], total: 0, page: 1, pageSize: 25 };

    const insights = await this.prisma.metaAdInsightDaily.findMany({
      where: { campaignId: { in: campaigns.map((c) => c.id) }, date: { gte: range.from, lte: range.to } },
    });
    const insightsByCampaign = new Map<string, typeof insights>();
    for (const row of insights) {
      if (!row.campaignId) continue;
      const bucket = insightsByCampaign.get(row.campaignId) ?? [];
      bucket.push(row);
      insightsByCampaign.set(row.campaignId, bucket);
    }

    const rows = campaigns.map((c) => {
      const metrics = aggregateInsights(insightsByCampaign.get(c.id) ?? []);
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        objective: c.objective,
        dailyBudget: c.dailyBudget,
        lifetimeBudget: c.lifetimeBudget,
        ...metrics,
        results: metrics.conversions,
        costPerResult: metrics.costPerConversion,
      };
    });

    return this.applySortAndPage(rows, query.sortBy, query.sortDir, query.page, query.pageSize);
  }

  async listAdSets(orgId: string, accountId: string, query: ListAdSetsQueryDto) {
    const account = await this.assertAccount(orgId, accountId);
    const range = resolveRange(query);

    const adSets = await this.prisma.metaAdSet.findMany({
      where: {
        campaign: { adAccountId: account.id, ...(query.campaignId ? { id: query.campaignId } : {}) },
        ...(query.search ? { name: { contains: query.search, mode: "insensitive" } } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      include: { campaign: { select: { id: true, name: true } } },
    });
    if (adSets.length === 0) return { rows: [], total: 0, page: 1, pageSize: 25 };

    const insights = await this.prisma.metaAdInsightDaily.findMany({
      where: { adSetId: { in: adSets.map((s) => s.id) }, date: { gte: range.from, lte: range.to } },
    });
    const insightsByAdSet = new Map<string, typeof insights>();
    for (const row of insights) {
      if (!row.adSetId) continue;
      const bucket = insightsByAdSet.get(row.adSetId) ?? [];
      bucket.push(row);
      insightsByAdSet.set(row.adSetId, bucket);
    }

    const rows = adSets.map((s) => {
      const metrics = aggregateInsights(insightsByAdSet.get(s.id) ?? []);
      return {
        id: s.id,
        name: s.name,
        status: s.status,
        campaignId: s.campaign.id,
        campaignName: s.campaign.name,
        dailyBudget: s.dailyBudget,
        lifetimeBudget: s.lifetimeBudget,
        ...metrics,
        results: metrics.conversions,
        costPerResult: metrics.costPerConversion,
      };
    });

    return this.applySortAndPage(rows, query.sortBy, query.sortDir, query.page, query.pageSize);
  }

  async listAds(orgId: string, accountId: string, query: ListAdsQueryDto) {
    const account = await this.assertAccount(orgId, accountId);
    const range = resolveRange(query);

    const ads = await this.prisma.metaAd.findMany({
      where: {
        adSet: {
          campaign: { adAccountId: account.id, ...(query.campaignId ? { id: query.campaignId } : {}) },
          ...(query.adSetId ? { id: query.adSetId } : {}),
        },
        ...(query.search ? { name: { contains: query.search, mode: "insensitive" } } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      include: { adSet: { select: { id: true, name: true, campaign: { select: { id: true, name: true } } } } },
    });
    if (ads.length === 0) return { rows: [], total: 0, page: 1, pageSize: 25 };

    const insights = await this.prisma.metaAdInsightDaily.findMany({
      where: { adId: { in: ads.map((a) => a.id) }, date: { gte: range.from, lte: range.to } },
    });
    const insightsByAd = new Map<string, typeof insights>();
    for (const row of insights) {
      if (!row.adId) continue;
      const bucket = insightsByAd.get(row.adId) ?? [];
      bucket.push(row);
      insightsByAd.set(row.adId, bucket);
    }

    const rows = ads.map((a) => {
      const metrics = aggregateInsights(insightsByAd.get(a.id) ?? []);
      return {
        id: a.id,
        name: a.name,
        status: a.status,
        thumbnailUrl: a.thumbnailUrl,
        adSetId: a.adSet.id,
        adSetName: a.adSet.name,
        campaignId: a.adSet.campaign.id,
        campaignName: a.adSet.campaign.name,
        ...metrics,
        results: metrics.conversions,
        costPerResult: metrics.costPerConversion,
      };
    });

    return this.applySortAndPage(rows, query.sortBy, query.sortDir, query.page, query.pageSize);
  }
}
