import { Injectable, Logger } from "@nestjs/common";
import { UpworkGraphQLClient } from "../shared/upwork-graphql.client";
import { UpworkApiConnectionService } from "../connection/upwork-api-connection.service";

/**
 * Organization & Agency domain (spec Module C) — LIVE as of 2026-10-23 for
 * identity fields, PARTIALLY blocked for company/staff details.
 *
 * Earlier this session this domain was marked fully blocked based on
 * `company`/`companySelector` both failing with a missing-scope error. Real
 * finding, 2026-10-23: that was too pessimistic — `organization`'s own
 * identity fields (id, rid, legacyId, name, type, legacyType, active,
 * hidden, photoUrl, creationDate, flag, parentOrganization) are NOT behind
 * that scope and return real data every time, confirmed live. Only
 * `.company` and `.staffs` are blocked (same missing-scope error as
 * `companySelector`). This method returns both: the always-available
 * identity block, and a best-effort company/staff block that is `null` with
 * an explicit `companyDetailsAvailable: false` when blocked — never
 * fabricated, per the spec's explicit anti-fabrication requirement.
 *
 * `flag.agency`/`flag.vendor` is Upwork's OWN classification of this
 * account — confirmed live for EurosHub: `{agency: true, vendor: true,
 * client: false, individual: false}`. This is the authoritative, API-
 * verified answer to "is this actually an agency account", not an
 * assumption made by this app.
 */
@Injectable()
export class UpworkAgencyProfileService {
  private readonly logger = new Logger(UpworkAgencyProfileService.name);

  constructor(
    private readonly connection: UpworkApiConnectionService,
    private readonly graphql: UpworkGraphQLClient,
  ) {}

  async getAgencyProfile(orgId: string) {
    return this.connection.withFreshTokenOnAuthFailure(orgId, async ({ accessToken, organizationId }) => {
      const profile = await this.graphql.getOrganizationProfile(accessToken, organizationId);
      const companyDetails = await this.graphql.getOrganizationCompanyDetails(accessToken, organizationId);
      return {
        profile,
        companyDetails,
        companyDetailsAvailable: companyDetails !== null,
        companyDetailsLimitation: companyDetails === null
          ? "Company/staff details are blocked by a missing Upwork app permission (CurrentOrganization.company / CurrentOrganization.staffs scope) — grant it on Upwork's Developer Portal and reconnect to unlock this."
          : null,
      };
    });
  }

  /** Real, consequential write against the agency's live Upwork
   *  organization record — see UpworkGraphQLClient.updateOrganization's
   *  own docblock. Requires the caller (controller) to have already
   *  obtained explicit user confirmation; this method does not add its own
   *  confirmation step, it trusts the caller. */
  async updateOrganization(
    orgId: string,
    input: { organizationName: string; hidden?: boolean; vatId?: string; phoneNumber?: string; timezone?: string },
  ) {
    return this.connection.withFreshTokenOnAuthFailure(orgId, async ({ accessToken, organizationId }) => {
      if (!organizationId) {
        throw new Error("No organization ID is configured for this connection — cannot update an organization without knowing which one.");
      }
      const result = await this.graphql.updateOrganization(accessToken, organizationId, { id: organizationId, ...input });
      this.logger.log(`Organization update for org ${orgId} (Upwork org ${organizationId}): success=${result.success}`);
      return result;
    });
  }
}
