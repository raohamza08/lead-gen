import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { UpworkApiConnectionService } from "../upwork-api-connection.service";

/**
 * Job discovery — point 6 of the Upwork API application ("Job discovery"):
 * relevant/matching job postings for our agency's skill categories. See
 * AgencyProfileService's docblock for why this is a stub, not a guess.
 */
@Injectable()
export class UpworkJobDiscoveryService {
  constructor(private readonly connection: UpworkApiConnectionService) {}

  async listRelevantJobs(orgId: string): Promise<never> {
    await this.connection.getValidAccessToken(orgId);
    throw new ServiceUnavailableException(
      "Job discovery sync isn't live yet — pending Upwork's app approval and a confirmed API schema.",
    );
  }
}
