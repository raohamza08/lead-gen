import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { UpworkGraphQLClient } from "../shared/upwork-graphql.client";
import { UpworkApiConnectionService } from "../connection/upwork-api-connection.service";

/**
 * Timesheets (spec Module E) — BLOCKED, confirmed live, a DIFFERENT kind
 * of gap than the usual missing-OAuth-scope class (Part: Upwork API
 * integration — enterprise module audit, 2026-10-23).
 *
 * Schema confirmed real and well-formed: `contractTimeReport(filter:
 * {organizationId_eq, timeReportDate_bt, contractIds?}, pagination)`
 * returns a real `TimeReport` type with rich fields (dateWorkedOn,
 * freelancer, team, contract, task, totalHoursWorked, totalCharges,
 * billRate) — exactly what this module needs, and does NOT require a
 * Contracts-scope lookup first (contractIds is optional). Date format
 * "YYYY-MM-DD" is correct (confirmed — an earlier attempt with full
 * ISO-8601 timestamps failed with a parse error, this is fixed).
 *
 * The real blocker: Upwork returns a 403 — `"User <id> has no access of
 * any team(s) for [view_gds_hourly_data_from_client,
 * view_gds_charges_data_from_client] action(s)"`. This is a TEAM-LEVEL
 * Upwork permission on the connected user's own account (set inside
 * Upwork's own team-management UI), not an OAuth app scope — granting a
 * new scope on the Developer Portal will NOT fix this. The connected
 * Upwork user needs to be granted the "view hourly/charges data" team
 * permission by an agency admin inside Upwork itself.
 *
 * Deliberately does NOT hardcode a permanent failure — retries live every
 * call, so this starts working automatically if that team permission is
 * ever granted inside Upwork, no code change needed.
 */
@Injectable()
export class UpworkTimesheetsService {
  private readonly logger = new Logger(UpworkTimesheetsService.name);

  constructor(
    private readonly connection: UpworkApiConnectionService,
    private readonly graphql: UpworkGraphQLClient,
  ) {}

  async listTimesheets(orgId: string) {
    return this.connection.withFreshTokenOnAuthFailure(orgId, async ({ accessToken, organizationId }) => {
      if (!organizationId) {
        throw new ServiceUnavailableException("No organization ID configured for this connection.");
      }
      const rangeEnd = new Date();
      const rangeStart = new Date(rangeEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
      try {
        return await this.graphql.getContractTimeReport(
          accessToken,
          organizationId,
          organizationId,
          rangeStart.toISOString().slice(0, 10),
          rangeEnd.toISOString().slice(0, 10),
        );
      } catch (err) {
        this.logger.warn(`Timesheets listing failed (confirmed Upwork team-permission gap as of 2026-10-23, re-tried live): ${(err as Error).message}`);
        throw new ServiceUnavailableException(
          "Timesheets access requires a team-level Upwork permission (view hourly/charges data) that the connected account doesn't currently have -- this must be granted inside Upwork's own team management, not this app's OAuth scopes. Confirmed real schema otherwise.",
        );
      }
    });
  }
}
