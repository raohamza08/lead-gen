import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { UpworkApiConnectionService } from "../upwork-api-connection.service";

/**
 * Bidding & proposal data — point 3 of the Upwork API application
 * ("Bidding & proposal data"). Not to be confused with UpworkProposal in
 * the existing `upwork` module, which is this app's own internal tracking
 * table, not data pulled from Upwork's API. See AgencyProfileService's
 * docblock for why this is a stub, not a guess.
 */
@Injectable()
export class UpworkBiddingService {
  constructor(private readonly connection: UpworkApiConnectionService) {}

  async listProposals(orgId: string): Promise<never> {
    await this.connection.getValidAccessToken(orgId);
    throw new ServiceUnavailableException(
      "Bidding/proposal sync isn't live yet — pending Upwork's app approval and a confirmed API schema.",
    );
  }
}
