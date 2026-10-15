import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { ProposalWritingSettingsService } from "./proposal-writing-settings.service";
import {
  computeRecommendation,
  computeSpendTier,
  isExcludedCountry,
  isHourly,
  isLongTermJob,
  minutesSincePosted,
  parseFirstInt,
  parseMoney,
} from "./bidding-criteria.util";
import type { DiscoveredJobEntryDto } from "../dto/discovered-job.dto";

@Injectable()
export class DiscoveredJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: ProposalWritingSettingsService,
  ) {}

  /** Upserts each scraped job on (orgId, jobUrl) — re-scanning the same
   *  search just refreshes existing rows rather than duplicating them.
   *  Computes every signal except the time-sensitive one (posting age vs
   *  the 15-minute window), which `list` recomputes fresh on every read
   *  instead of trusting a number frozen at ingest time. */
  async ingest(orgId: string, jobs: DiscoveredJobEntryDto[]) {
    if (jobs.length === 0) return { ingested: 0 };
    const settings = await this.settingsService.get(orgId);

    for (const job of jobs) {
      const facts = job.facts ?? {};
      const client = job.client ?? {};
      const totalSpentUsd = parseMoney(client["Total spent"]);
      const totalHires = parseFirstInt(client["Hires"]);
      const spendTier = computeSpendTier(totalSpentUsd, totalHires);
      const longTerm = isLongTermJob(facts);
      const hourly = isHourly(facts);
      const excludedCountry = isExcludedCountry(client["Country"], settings.excludedCountries);
      const postedMinutesAgo = minutesSincePosted(job.postedAt);

      const { recommendation, reasons } = computeRecommendation({
        isExcludedCountry: excludedCountry,
        spendTier,
        isLongTerm: longTerm,
        isHourly: hourly,
        postedMinutesAgo,
      });

      await this.prisma.upworkDiscoveredJob.upsert({
        where: { orgId_jobUrl: { orgId, jobUrl: job.jobUrl } },
        create: {
          orgId,
          jobUrl: job.jobUrl,
          title: job.title,
          postedAt: job.postedAt ? new Date(job.postedAt) : null,
          facts,
          client,
          skills: job.skills ?? [],
          spendTier,
          isLongTerm: longTerm,
          isHourly: hourly,
          recommendation,
          reasons,
        },
        update: {
          title: job.title,
          postedAt: job.postedAt ? new Date(job.postedAt) : null,
          facts,
          client,
          skills: job.skills ?? [],
          spendTier,
          isLongTerm: longTerm,
          isHourly: hourly,
          recommendation,
          reasons,
        },
      });
    }

    return { ingested: jobs.length };
  }

  /** Recomputes the posting-age factor fresh on every read — a job
   *  discovered 20 minutes ago and still sitting in this list should show
   *  as stale now even if it looked fine the moment it was ingested. */
  async list(orgId: string, limit = 50) {
    const rows = await this.prisma.upworkDiscoveredJob.findMany({
      where: { orgId },
      orderBy: { discoveredAt: "desc" },
      take: limit,
    });

    return rows.map((row) => {
      const postedMinutesAgo = row.postedAt ? minutesSincePosted(row.postedAt.toISOString()) : null;
      if (row.recommendation === "SKIP") {
        return { ...row, postedMinutesAgo };
      }
      const { recommendation, reasons } = computeRecommendation({
        isExcludedCountry: false, // already baked into SKIP at ingest time; never re-derived from stored data here
        spendTier: (row.spendTier as Parameters<typeof computeRecommendation>[0]["spendTier"]) ?? "UNKNOWN",
        isLongTerm: row.isLongTerm,
        isHourly: row.isHourly,
        postedMinutesAgo,
      });
      return { ...row, recommendation, reasons, postedMinutesAgo };
    });
  }
}
