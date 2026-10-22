import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";

/**
 * Freelancer Profiles (spec Module H) — LIVE (Part: Upwork API
 * integration — Freelancer Profiles domain, 2026-10-23). Reads only —
 * UpworkFreelancerProfilesSyncWorker/Service own talking to Upwork on a
 * schedule. Agency-scoped by construction (see sync service's own
 * docblock) — never the connected user's own personal profile.
 */
@Injectable()
export class UpworkFreelancerProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  async listProfiles(orgId: string) {
    const profiles = await this.prisma.upworkApiFreelancerProfile.findMany({
      where: { orgId },
      orderBy: { totalEarnings: "desc" },
    });
    return {
      totalCount: profiles.length,
      profiles: profiles.map((p) => ({
        id: p.id,
        freelancerUserId: p.freelancerUserId,
        freelancerName: p.freelancerName,
        topRatedStatus: p.topRatedStatus,
        totalEarnings: p.totalEarnings,
        totalJobs: p.totalJobs,
        totalFeedback: p.totalFeedback,
        lastWorkedOn: p.lastWorkedOn,
        skills: Array.isArray(p.skillsJson) ? (p.skillsJson as { prettyName: string | null }[]).map((s) => s.prettyName).filter(Boolean) : [],
      })),
    };
  }
}
