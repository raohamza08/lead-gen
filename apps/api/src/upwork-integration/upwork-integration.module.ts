import { Module } from "@nestjs/common";
import { UpworkApiController } from "./upwork-api.controller";
import { UpworkOAuthCallbackController } from "./upwork-oauth-callback.controller";
import { UpworkApiConnectionService } from "./upwork-api-connection.service";
import { UpworkOAuthClient } from "./upwork-oauth.client";
import { UpworkOAuthStateStore } from "./upwork-oauth-state.store";
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
 *      plumbing (UpworkOAuthClient, UpworkApiConnectionService) is already
 *      real and doesn't need to change.
 */
@Module({
  controllers: [UpworkApiController, UpworkOAuthCallbackController],
  providers: [
    UpworkApiConnectionService,
    UpworkOAuthClient,
    UpworkOAuthStateStore,
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
