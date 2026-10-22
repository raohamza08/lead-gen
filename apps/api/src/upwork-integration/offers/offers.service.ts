import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { UpworkGraphQLClient } from "../shared/upwork-graphql.client";
import { UpworkApiConnectionService } from "../connection/upwork-api-connection.service";

/**
 * Offers (spec Module J) — BLOCKED, confirmed live, NOT a scope gap
 * (Part: Upwork API integration — enterprise module audit, 2026-10-23).
 *
 * Schema confirmed real: `offersByAttributes(filter: {ids, searchAttribute:
 * VendorOrg})` is the correct query to list every offer for our agency org,
 * and `ModernizedContractOffer`'s fields (id, title, state, clientOrgId,
 * vendorOrgId, contractId, createdDateTime, etc.) are all confirmed via
 * introspection. The query itself is reachable (no "missing scope" error,
 * unlike company/staffs/vendorContracts) — but it fails EVERY time with a
 * reproducible Upwork-side error: `"Upstream response processing timed
 * out"` / `TRANSFORM_TIMEOUT`, confirmed 3-for-3 attempts at ~2.3s each.
 * This is Upwork's own backend failing to process the response for this
 * account's offer volume, not a client-side bug.
 *
 * A single-offer fallback (`offer(id!)`) was considered, but there is no
 * reliable source of individual offer IDs to look up: offer IDs would
 * naturally come from Contracts (`ContractDetails.offerId`), and the
 * entire Contracts surface is separately confirmed scope-blocked (see
 * upwork-integration.module.ts's own docblock) — so there is no path to
 * this module's data right now through either route.
 *
 * Deliberately does NOT hardcode a permanent "blocked" response — it
 * attempts the real call every time this is invoked, so this starts
 * working automatically (no code change needed) if either: (a) Upwork's
 * backend timeout clears on its own, or (b) the Contracts scope is ever
 * granted, which would also unblock a single-offer-ID fallback path.
 */
@Injectable()
export class UpworkOffersService {
  private readonly logger = new Logger(UpworkOffersService.name);

  constructor(
    private readonly connection: UpworkApiConnectionService,
    private readonly graphql: UpworkGraphQLClient,
  ) {}

  async listOffers(orgId: string) {
    return this.connection.withFreshTokenOnAuthFailure(orgId, async ({ accessToken, organizationId }) => {
      if (!organizationId) {
        throw new ServiceUnavailableException("No organization ID configured for this connection.");
      }
      try {
        return await this.graphql.getOffers(accessToken, organizationId, organizationId);
      } catch (err) {
        this.logger.warn(`Offers listing failed (confirmed Upwork-side TRANSFORM_TIMEOUT as of 2026-10-23, re-tried live): ${(err as Error).message}`);
        throw new ServiceUnavailableException(
          "Offers listing is currently blocked by a reproducible Upwork backend error (offersByAttributes). Confirmed real schema, not a missing permission -- this will start working automatically if Upwork's backend issue clears.",
        );
      }
    });
  }
}
