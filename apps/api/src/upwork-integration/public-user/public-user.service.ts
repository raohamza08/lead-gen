import { Injectable } from "@nestjs/common";
import { UpworkGraphQLClient } from "../shared/upwork-graphql.client";
import { UpworkApiConnectionService } from "../connection/upwork-api-connection.service";

/**
 * Public User Details (spec Module O) — LIVE (Part: Upwork API
 * integration — Public User Details domain, 2026-10-23). On-demand
 * lookup only, no DB storage or sync worker — `userDetails(id!)` has no
 * bulk/directory listing in the schema, it's a per-ID resolver. Kept
 * clearly separate from private agency-member/connected-account data per
 * the spec's own requirement; never merged into those datasets.
 */
@Injectable()
export class UpworkPublicUserService {
  constructor(
    private readonly connection: UpworkApiConnectionService,
    private readonly graphql: UpworkGraphQLClient,
  ) {}

  async getUserDetails(orgId: string, userId: string) {
    return this.connection.withFreshTokenOnAuthFailure(orgId, async ({ accessToken, organizationId }) => {
      const user = await this.graphql.getUserDetails(accessToken, organizationId, userId);
      return { ...user, dataScope: "public_user" as const };
    });
  }
}
