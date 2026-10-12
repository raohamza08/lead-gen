import { Module } from "@nestjs/common";
import { UpworkApiController } from "./upwork-api.controller";
import { UpworkOAuthCallbackController } from "./upwork-oauth-callback.controller";
import { UpworkApiConnectionService } from "./upwork-api-connection.service";
import { UpworkOAuthClient } from "./upwork-oauth.client";
import { UpworkOAuthStateStore } from "./upwork-oauth-state.store";
import { UpworkGraphQLClient } from "./upwork-graphql.client";
import { UpworkAgencyProfileService } from "./services/agency-profile.service";
import { UpworkInvitesService } from "./services/invites.service";
import { UpworkBiddingService } from "./services/bidding.service";
import { UpworkConnectsUsageService } from "./services/connects-usage.service";
import { UpworkJobDiscoveryService } from "./services/job-discovery.service";
import { UpworkReportingService } from "./services/reporting.service";
import { UpworkChatMonitoringService } from "./services/chat-monitoring.service";

/**
 * The real Upwork API OAuth integration (Part: Upwork API integration,
 * 2026-10-12) — distinct from the existing `upwork` module, which is this
 * app's own internal PM-hour-request/proposal-tracking system and has never
 * talked to Upwork's actual API. This module exists to (a) give Upwork's
 * app-review form a live, resolving callback URL
 * ({API_PUBLIC_URL}/upwork-oauth/callback) and (b) have the connect flow and
 * a module shell per data domain from the application already wired, ready
 * to drop real logic into once the app is approved.
 *
 * Standing decisions, both explicit user requests, both load-bearing for
 * anyone touching this module next:
 *   1. Hidden from everyone but one named account for now — see
 *      UpworkApiOwnerGuard's docblock, which every route in
 *      UpworkApiController sits behind instead of the usual
 *      ModuleAccessGuard stack.
 *   2. Every per-domain service under ./services/ (agency profile, invites,
 *      bidding, Connects usage, job discovery, reporting, chat monitoring)
 *      is a deliberate stub that throws ServiceUnavailableException, not a
 *      best-guess implementation against Upwork's real (GraphQL) data API —
 *      we don't have credentials to test against yet, and shipping
 *      unverified logic here was explicitly ruled out ("i cannot take any
 *      risk on this one"). Replace each stub's one method with a real call
 *      once the app is approved and the schema is confirmed; the OAuth
 *      plumbing (UpworkOAuthClient, UpworkApiConnectionService,
 *      UpworkGraphQLClient) is already real and doesn't need to change.
 *
 * Constraints confirmed from Upwork's own docs (developer/documentation/
 * graphql/api/docs, checked 2026-10-12) that the real implementations must
 * respect, not just the connect flow:
 *   - GraphQL endpoint is https://api.upwork.com/graphql; set
 *     X-Upwork-API-TenantId from UpworkApiConnectionService.getValidAccessToken's
 *     organizationId (omit it and Upwork silently falls back to the user's
 *     default org, which is fine for a single-org agency but worth being
 *     deliberate about).
 *   - "we don't allow storing data for more than 24 hours" — any new table
 *     holding synced data needs a TTL/refresh design, not a permanent cache
 *     (see UpworkApiConnection's own schema docblock).
 *   - Rate limits: 300 requests/min per IP, 40,000/day — sync workers need
 *     real backoff on HTTP 429, not just retry-until-it-works.
 *   - GraphQL errors come back as HTTP 200 with an `errors` array (only
 *     transport failures are non-200) — a real client must check that
 *     array, not just response.ok (see UpworkGraphQLClient.getDefaultOrganization
 *     for the one place this is already done).
 *   - Upwork supports webhook subscriptions for Job Postings, Offers, Job
 *     Applications, Milestones, and Contract Feedback — worth using instead
 *     of a polling sync worker for UpworkJobDiscoveryService/
 *     UpworkBiddingService specifically, not just defaulting to polling.
 */
@Module({
  controllers: [UpworkApiController, UpworkOAuthCallbackController],
  providers: [
    UpworkApiConnectionService,
    UpworkOAuthClient,
    UpworkOAuthStateStore,
    UpworkGraphQLClient,
    UpworkAgencyProfileService,
    UpworkInvitesService,
    UpworkBiddingService,
    UpworkConnectsUsageService,
    UpworkJobDiscoveryService,
    UpworkReportingService,
    UpworkChatMonitoringService,
  ],
})
export class UpworkIntegrationModule {}
