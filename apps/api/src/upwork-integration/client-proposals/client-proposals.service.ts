import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { UpworkApiConnectionService } from "../connection/upwork-api-connection.service";

/**
 * Client Proposals (spec Module P) — NOT APPLICABLE to this account's
 * real role, confirmed live (Part: Upwork API integration — enterprise
 * module audit, 2026-10-23).
 *
 * `clientProposals(jobPostingId!, ...)` and its mutations
 * (markClientProposalAsRead/declineClientProposal/hideClientProposal/
 * shortlistClientProposal/messageClientProposal) all operate on job
 * postings THIS ACCOUNT OWNS AS A CLIENT — i.e. proposals freelancers
 * submitted to a job this account posted asking for work. Confirmed live
 * via `organization { flag }` (Part: Organization domain, 2026-10-22):
 * EurosHub's real flag is `{client: false, vendor: true, agency: true,
 * individual: false}` — this account IS a vendor/agency, not a client
 * that posts jobs. There is therefore no accessible `jobPostingId` this
 * account owns to query, and this is a genuine role mismatch, not a
 * missing permission.
 *
 * Not to be confused with "Client Proposals" in the colloquial sense of
 * "proposals WE submitted to clients" — that's `vendorProposals`
 * (Module J's Bidding/proposals domain, already live).
 */
@Injectable()
export class UpworkClientProposalsService {
  constructor(private readonly connection: UpworkApiConnectionService) {}

  async list(orgId: string): Promise<never> {
    await this.connection.getValidAccessToken(orgId);
    throw new ServiceUnavailableException(
      "Client Proposals is not applicable to this account's real role on Upwork: this account is a vendor/agency (confirmed via organization.flag: {client: false, vendor: true}), not a client that posts jobs -- clientProposals operates on job postings the caller owns as a client, which this account has none of.",
    );
  }
}
