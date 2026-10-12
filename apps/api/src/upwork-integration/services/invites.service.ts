import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { UpworkApiConnectionService } from "../upwork-api-connection.service";

/**
 * Invite tracking — point 2 of the Upwork API application ("Invite
 * tracking"): pulling/updating the status of client job invitations. See
 * AgencyProfileService's docblock for why this is a stub, not a guess.
 */
@Injectable()
export class UpworkInvitesService {
  constructor(private readonly connection: UpworkApiConnectionService) {}

  async listInvites(orgId: string): Promise<never> {
    await this.connection.getValidAccessToken(orgId);
    throw new ServiceUnavailableException(
      "Invite sync isn't live yet — pending Upwork's app approval and a confirmed API schema.",
    );
  }
}
