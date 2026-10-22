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
import { UpworkConnectsSyncQueue } from "./upwork-connects-sync.queue";
import { UpworkConnectsSyncWorker } from "./upwork-connects-sync.worker";
import { UpworkConnectsSyncService } from "./upwork-connects-sync.service";

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
 *   1. Gated by the standard upworkApiAccess module flag, same mechanism
 *      as every other module — see UpworkApiController's own docblock.
 *      (Briefly hidden from everyone but one hardcoded email instead; that
 *      was replaced with the standard flag per explicit user request —
 *      "make the module an access option... rather than hardcoding it".)
 *   2. Every per-domain service under ./services/ EXCEPT Connects usage
 *      (agency profile, invites, bidding, job discovery, reporting, chat
 *      monitoring) is still a deliberate stub that throws
 *      ServiceUnavailableException, not a best-guess implementation against
 *      Upwork's real (GraphQL) data API — shipping unverified logic was
 *      explicitly ruled out ("i cannot take any risk on this one"). Connects
 *      usage went live 2026-10-22 (Part: Upwork API integration — real
 *      credentials arrived, first of the 7 domains built, one at a time,
 *      each verified by LIVE introspection against the real API before any
 *      Prisma model/service code was written — see UpworkConnectsSyncService
 *      and UpworkGraphQLClient.getConnectsSummary/getConnectUsageHistoryPage
 *      for the confirmed real query shapes). Replace each remaining stub's
 *      one method the same way — introspect first, build second — once each
 *      one's turn comes; the OAuth plumbing (UpworkOAuthClient,
 *      UpworkApiConnectionService, UpworkGraphQLClient) is already real and
 *      doesn't need to change.
 *
 * Constraints confirmed from Upwork's own docs (developer/documentation/
 * graphql/api/docs, checked 2026-10-12) that the real implementations must
 * respect, not just the connect flow:
 *   - GraphQL endpoint is https://api.upwork.com/graphql; set
 *     X-Upwork-API-TenantId from UpworkApiConnectionService.getValidAccessToken's
 *     organizationId (omit it and Upwork silently falls back to the user's
 *     default org, which is fine for a single-org agency but worth being
 *     deliberate about).
 *   - "we don't allow storing data for more than 24 hours" (Upwork's own
 *     docs; a 2026-08 terms rewrite may have broadened this further — exact
 *     current wording unverifiable, see the 2026-10-22 retention decision
 *     below) — any new table holding RICH synced content (job descriptions,
 *     messages, proposal text) needs a TTL/refresh design, not a permanent
 *     cache. Explicit user decision 2026-10-22: numbers about the org's OWN
 *     account state (Connects balance/spend history, financial totals) are
 *     a different category — our own derived business records, not
 *     bulk-copied Upwork Content — and ARE stored permanently (see
 *     UpworkConnectsSnapshot/UpworkConnectsTransaction's own docblocks).
 *     Apply the same rich-content-TTL vs. own-metric-permanent split to each
 *     remaining domain, don't default to permanent everywhere.
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
    UpworkConnectsSyncQueue,
    UpworkConnectsSyncWorker,
    UpworkConnectsSyncService,
  ],
})
export class UpworkIntegrationModule {}
