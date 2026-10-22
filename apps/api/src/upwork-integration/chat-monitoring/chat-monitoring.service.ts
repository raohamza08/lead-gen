import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { UpworkApiConnectionService } from "../connection/upwork-api-connection.service";

/**
 * Client communication monitoring — point 5 of the Upwork API application
 * ("Client communication monitoring (internal alerting only)"): detects
 * concern/update signals in contract message activity and notifies the
 * assigned freelancer internally. Deliberately scoped in the application
 * text to detection + internal alerting only — never auto-replying on
 * anyone's behalf — keep that contract when this stub is eventually
 * replaced with a real implementation, not just when writing the
 * application text. See AgencyProfileService's docblock for why this is a
 * stub, not a guess — this is also the single most sensitive scope of the
 * whole integration (reads message content), so it should be the last one
 * implemented, after the lower-risk domains have been verified against
 * real Upwork responses.
 */
@Injectable()
export class UpworkChatMonitoringService {
  constructor(private readonly connection: UpworkApiConnectionService) {}

  async scanActiveContractsForConcerns(orgId: string): Promise<never> {
    await this.connection.getValidAccessToken(orgId);
    throw new ServiceUnavailableException(
      "Client communication monitoring isn't live yet — pending Upwork's app approval and a confirmed API schema.",
    );
  }
}
