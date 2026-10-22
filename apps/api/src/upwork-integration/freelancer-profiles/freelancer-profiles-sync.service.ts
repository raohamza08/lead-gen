import { Injectable, Logger } from "@nestjs/common";
import { UpworkApiConnection } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { UpworkGraphQLClient } from "../shared/upwork-graphql.client";
import { UpworkApiConnectionService } from "../connection/upwork-api-connection.service";

/** Same cap/reasoning as UpworkWorkHistorySyncService's own
 *  MAX_FREELANCERS_PER_TICK. */
const MAX_FREELANCERS_PER_TICK = 200;

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Freelancer Profiles sync logic (spec Module H, Part: Upwork API
 * integration — Freelancer Profiles domain, 2026-10-23) — same split as
 * every other Upwork sync service. `talentProfile` requires a specific
 * freelancer `personId` with no bulk listing, so this syncs ONE
 * freelancer at a time, sourced the exact same way as
 * UpworkWorkHistorySyncService — only freelancers with a real, verified
 * proposal/invite relationship to this agency, never a blanket pull of
 * the connected user's own personal profile.
 */
@Injectable()
export class UpworkFreelancerProfilesSyncService {
  private readonly logger = new Logger(UpworkFreelancerProfilesSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connection: UpworkApiConnectionService,
    private readonly graphql: UpworkGraphQLClient,
  ) {}

  async syncConnection(connectionRow: UpworkApiConnection): Promise<void> {
    try {
      await this.connection.withFreshTokenOnAuthFailure(connectionRow.orgId, async ({ accessToken, organizationId }) => {
        const freelancers = await this.getKnownFreelancers(connectionRow.orgId);
        for (const freelancer of freelancers.slice(0, MAX_FREELANCERS_PER_TICK)) {
          try {
            const profile = await this.graphql.getTalentProfile(accessToken, organizationId, freelancer.id);
            if (!profile) continue;
            const data = {
              freelancerName: freelancer.name,
              topRatedStatus: profile.profileAggregates?.topRatedStatus ?? null,
              totalEarnings: profile.profileAggregates?.totalEarnings ?? null,
              totalJobs: profile.profileAggregates?.totalJobs ?? null,
              totalHourlyJobs: profile.profileAggregates?.totalHourlyJobs ?? null,
              totalFixedJobs: profile.profileAggregates?.totalFixedJobs ?? null,
              totalFeedback: profile.profileAggregates?.totalFeedback ?? null,
              lastWorkedOn: toDate(profile.profileAggregates?.lastWorkedOn),
              skillsJson: profile.skills ?? [],
            };
            await this.prisma.upworkApiFreelancerProfile.upsert({
              where: { orgId_freelancerUserId: { orgId: connectionRow.orgId, freelancerUserId: freelancer.id } },
              create: { orgId: connectionRow.orgId, freelancerUserId: freelancer.id, ...data },
              update: data,
            });
          } catch (err) {
            this.logger.warn(`Freelancer profile sync failed for freelancer ${freelancer.id} (org ${connectionRow.orgId}): ${(err as Error).message}`);
          }
        }
      });
      await this.prisma.upworkApiConnection.update({
        where: { id: connectionRow.id },
        data: { lastSyncAt: new Date(), lastSyncError: null },
      });
    } catch (err) {
      const message = (err as Error).message.slice(0, 300);
      this.logger.warn(`Freelancer profiles sync failed for org ${connectionRow.orgId}: ${message}`);
      await this.prisma.upworkApiConnection.update({
        where: { id: connectionRow.id },
        data: { lastSyncError: message },
      });
      throw err;
    }
  }

  private async getKnownFreelancers(orgId: string): Promise<{ id: string; name: string | null }[]> {
    const [fromProposals, fromInvites] = await Promise.all([
      this.prisma.upworkApiProposal.findMany({
        where: { orgId, freelancerUserId: { not: null } },
        distinct: ["freelancerUserId"],
        select: { freelancerUserId: true, freelancerName: true },
      }),
      this.prisma.upworkApiInvite.findMany({
        where: { orgId, freelancerUserId: { not: null } },
        distinct: ["freelancerUserId"],
        select: { freelancerUserId: true, freelancerName: true },
      }),
    ]);
    const byId = new Map<string, string | null>();
    for (const row of [...fromProposals, ...fromInvites]) {
      if (row.freelancerUserId) byId.set(row.freelancerUserId, row.freelancerName);
    }
    return Array.from(byId.entries()).map(([id, name]) => ({ id, name }));
  }
}
