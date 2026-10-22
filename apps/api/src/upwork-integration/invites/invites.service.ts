import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { UpworkApiConnectionService } from "../connection/upwork-api-connection.service";

/**
 * Invite tracking — point 2 of the Upwork API application ("Invite
 * tracking"): pulling/updating the status of client job invitations. Not
 * yet attempted (unlike Connects usage/Bidding, which are live, and Agency
 * profile, which was attempted and found blocked) — still a genuine
 * "haven't gotten to it yet" stub. Real lead for whoever builds this next
 * (Part: Upwork API integration, 2026-10-22, found while introspecting the
 * Bidding/proposals domain): `GenericOrganization.vendorInvitations` —
 * "Returns list of invitations for a given status, freelancer or
 * freelancer's team as viewed by this vendor organization" — confirmed to
 * exist in-schema via introspection, reachable as a field on the
 * `organization { vendorInvitations }` query, NOT a standalone top-level
 * query. Not yet introspected in depth (arg shape, return type) or tested
 * live — do that first, same introspect-before-build discipline as every
 * other domain.
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
