import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { UpworkApiConnectionService } from "../upwork-api-connection.service";

/**
 * Connects usage monitoring — point 4 of the Upwork API application
 * ("Connects usage monitoring"). See AgencyProfileService's docblock for
 * why this is a stub, not a guess.
 */
@Injectable()
export class UpworkConnectsUsageService {
  constructor(private readonly connection: UpworkApiConnectionService) {}

  async getConnectsUsage(orgId: string): Promise<never> {
    await this.connection.getValidAccessToken(orgId);
    throw new ServiceUnavailableException(
      "Connects usage sync isn't live yet — pending Upwork's app approval and a confirmed API schema.",
    );
  }
}
