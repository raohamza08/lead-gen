import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { UpworkApiConnectionService } from "../connection/upwork-api-connection.service";

/**
 * Agency & profile sync — point 1 of the Upwork API application
 * ("Agency & profile management"). GENUINELY BLOCKED, confirmed live
 * (2026-10-22, not just "unapproved" like the other remaining stubs): both
 * the `company` and `companySelector` GraphQL queries return "The client or
 * authentication token doesn't have enough oauth2 permissions/scopes to
 * access" for this app's current Upwork credentials. Do not re-attempt this
 * domain without first confirming the missing scope has been granted on
 * Upwork's Developer Portal — see Settings > Upwork API's own hint text for
 * the user-facing version of this note.
 */
@Injectable()
export class UpworkAgencyProfileService {
  constructor(private readonly connection: UpworkApiConnectionService) {}

  async getAgencyProfile(orgId: string): Promise<never> {
    await this.connection.getValidAccessToken(orgId); // confirms a live connection exists before failing on the actual fetch
    throw new ServiceUnavailableException(
      "Agency profile sync is blocked by a missing Upwork app permission (company/companySelector scope) — grant it on Upwork's Developer Portal and reconnect.",
    );
  }
}
