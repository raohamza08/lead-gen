import { Injectable } from "@nestjs/common";
import { UpworkGraphQLClient } from "../shared/upwork-graphql.client";
import { UpworkApiConnectionService } from "../connection/upwork-api-connection.service";

/**
 * Contract Proposals (spec Module L) — LIVE, READ ONLY (Part: Upwork API
 * integration — Contract Proposals domain, 2026-10-23). Confirmed live:
 * EurosHub's own org ID works directly as `agencyTeamId`, no separate
 * team-ID lookup needed. Live/on-demand only, no DB sync — confirmed
 * zero current results for this org, and the schema has no date-range
 * filter that would make an incremental sync meaningful yet. Keep this
 * read-only per the spec's explicit requirement — no write action exists
 * anywhere in this module.
 */
@Injectable()
export class UpworkContractProposalsService {
  constructor(
    private readonly connection: UpworkApiConnectionService,
    private readonly graphql: UpworkGraphQLClient,
  ) {}

  async list(orgId: string, page: number) {
    return this.connection.withFreshTokenOnAuthFailure(orgId, async ({ accessToken, organizationId }) => {
      if (!organizationId) {
        throw new Error("No organization ID configured for this connection -- cannot resolve the agency team ID.");
      }
      const result = await this.graphql.getContractProposalsByAgency(accessToken, organizationId, organizationId, page);
      return {
        totalCount: result.paging?.total ?? 0,
        page: result.paging?.page ?? page,
        contracts: (result.contracts ?? []).map((c) => ({
          id: c.id,
          referenceContractRid: c.referenceContractRid,
          createdDate: c.createdDate,
          jobTitle: c.offerDetails?.title ?? null,
          clientName: [c.client?.personName?.firstName, c.client?.personName?.lastName].filter(Boolean).join(" ") || null,
        })),
      };
    });
  }
}
