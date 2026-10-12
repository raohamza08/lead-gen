import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { UpworkApiConnectionService } from "../upwork-api-connection.service";

/**
 * Agency & profile sync — point 1 of the Upwork API application
 * ("Agency & profile management"). Stubbed until the app is approved and
 * Upwork's actual profile-read GraphQL query is confirmed; see
 * upwork-integration.module.ts's docblock for why nothing here calls a
 * guessed endpoint yet.
 */
@Injectable()
export class UpworkAgencyProfileService {
  constructor(private readonly connection: UpworkApiConnectionService) {}

  async getAgencyProfile(orgId: string): Promise<never> {
    await this.connection.getValidAccessToken(orgId); // confirms a live connection exists before failing on the actual fetch
    throw new ServiceUnavailableException(
      "Agency profile sync isn't live yet — pending Upwork's app approval and a confirmed API schema.",
    );
  }
}
