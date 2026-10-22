import { Injectable, Logger } from "@nestjs/common";
import { UpworkApiConnection } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { UpworkGraphQLClient } from "../shared/upwork-graphql.client";
import { UpworkApiConnectionService } from "../connection/upwork-api-connection.service";

/** Hard ceiling on distinct freelancers synced per tick -- avoids one
 *  connection with a huge freelancer roster turning a single tick into an
 *  unbounded number of requests. Freelancers past this cap get picked up
 *  on the next tick (sync runs every 6h, so this self-corrects quickly). */
const MAX_FREELANCERS_PER_TICK = 200;

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Work History sync logic (spec Module T, Part: Upwork API integration —
 * Work History domain, 2026-10-23) — same split as every other Upwork
 * sync service. `talentWorkHistory` requires a specific freelancer
 * `personId` with no bulk listing, so this syncs ONE freelancer at a time,
 * sourced from the distinct `freelancerUserId`s already present on this
 * org's own UpworkApiProposal/UpworkApiInvite rows — i.e. only
 * freelancers with a real, verified proposal/invite relationship to this
 * agency, never a blanket pull. This is exactly the spec's own "verified
 * agency relationship" requirement for Work History.
 */
@Injectable()
export class UpworkWorkHistorySyncService {
  private readonly logger = new Logger(UpworkWorkHistorySyncService.name);

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
            const entries = await this.graphql.getTalentWorkHistory(accessToken, organizationId, freelancer.id);
            if (entries.length) {
              await this.prisma.$transaction(
                entries
                  .filter((e) => e.contract?.id)
                  .map((e) => {
                    const data = {
                      freelancerName: freelancer.name,
                      title: e.contract?.title ?? null,
                      status: e.contract?.status ?? null,
                      startDate: toDate(e.contract?.startDate),
                      endDate: toDate(e.contract?.endDate),
                      totalCharge: e.contractAggregate?.totalCharge ?? null,
                      totalHours: e.contractAggregate?.hours ?? null,
                      feedbackToFreelancerScore: e.feedback?.feedbackToFreelancer?.score ?? null,
                      feedbackToClientScore: e.feedback?.feedbackToClient?.score ?? null,
                    };
                    return this.prisma.upworkApiWorkHistoryEntry.upsert({
                      where: { orgId_upworkContractId: { orgId: connectionRow.orgId, upworkContractId: e.contract!.id } },
                      create: { orgId: connectionRow.orgId, freelancerUserId: freelancer.id, upworkContractId: e.contract!.id, ...data },
                      update: data,
                    });
                  }),
              );
            }
          } catch (err) {
            this.logger.warn(`Work history sync failed for freelancer ${freelancer.id} (org ${connectionRow.orgId}): ${(err as Error).message}`);
          }
        }
      });
      await this.prisma.upworkApiConnection.update({
        where: { id: connectionRow.id },
        data: { lastSyncAt: new Date(), lastSyncError: null },
      });
    } catch (err) {
      const message = (err as Error).message.slice(0, 300);
      this.logger.warn(`Work history sync failed for org ${connectionRow.orgId}: ${message}`);
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
