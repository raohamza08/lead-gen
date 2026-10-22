import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";

const RECENT_LIMIT = 100;

/**
 * Work History (spec Module T) — LIVE (Part: Upwork API integration —
 * Work History domain, 2026-10-23). Reads only — UpworkWorkHistorySync-
 * Worker/Service own talking to Upwork on a schedule. Scoped to
 * freelancers with a verified agency relationship (see sync service's
 * own docblock) — never the connected user's own unrelated personal
 * history.
 */
@Injectable()
export class UpworkWorkHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async listWorkHistory(orgId: string) {
    const [recent, totalCount, byFreelancer] = await Promise.all([
      this.prisma.upworkApiWorkHistoryEntry.findMany({
        where: { orgId },
        orderBy: { startDate: "desc" },
        take: RECENT_LIMIT,
      }),
      this.prisma.upworkApiWorkHistoryEntry.count({ where: { orgId } }),
      this.prisma.upworkApiWorkHistoryEntry.groupBy({
        by: ["freelancerUserId", "freelancerName"],
        where: { orgId },
        _count: { _all: true },
      }),
    ]);

    return {
      totalCount,
      freelancerCount: byFreelancer.length,
      recent: recent.map((e) => ({
        id: e.id,
        freelancerName: e.freelancerName,
        title: e.title,
        status: e.status,
        startDate: e.startDate,
        endDate: e.endDate,
        totalCharge: e.totalCharge,
        totalHours: e.totalHours,
        feedbackToFreelancerScore: e.feedbackToFreelancerScore,
        feedbackToClientScore: e.feedbackToClientScore,
      })),
    };
  }
}
