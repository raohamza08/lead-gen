import { Module } from "@nestjs/common";
import { UpworkSharedModule } from "./shared/upwork-shared.module";
import { UpworkConnectionModule } from "./connection/connection.module";
import { UpworkConnectsUsageModule } from "./connects-usage/connects-usage.module";
import { UpworkProposalsModule } from "./proposals/proposals.module";
import { UpworkAgencyProfileModule } from "./agency-profile/agency-profile.module";
import { UpworkInvitesModule } from "./invites/invites.module";
import { UpworkJobDiscoveryModule } from "./job-discovery/job-discovery.module";
import { UpworkReportingModule } from "./reporting/reporting.module";
import { UpworkChatMonitoringModule } from "./chat-monitoring/chat-monitoring.module";

/**
 * The real Upwork API OAuth integration (Part: Upwork API integration,
 * 2026-10-12) — distinct from the existing `upwork` module, which is this
 * app's own internal PM-hour-request/proposal-tracking system and has never
 * talked to Upwork's actual API.
 *
 * Restructured into one NestJS sub-module per domain (Part: modular
 * architecture pass, 2026-10-22, explicit user request — "Each module must
 * be designed and implemented separately rather than combining all
 * functionalities into a single place... clear folder structure so each
 * module can be developed, tested, maintained, and extended independently").
 * This file is now a pure aggregator — no providers/controllers of its own,
 * just imports. Structure:
 *
 *   shared/            UpworkGraphQLClient — the one piece every domain needs.
 *   connection/         OAuth connect/status/disconnect/org-id override — the
 *                        stable base every domain module builds on, has no
 *                        dependency on any domain module itself.
 *   connects-usage/      LIVE. Self-contained: read service, sync Queue/
 *                         Worker/Service, controller. Only depends on shared/.
 *   proposals/            LIVE, same shape as connects-usage/.
 *   agency-profile/       BLOCKED — see its service's own docblock (missing
 *                          Upwork scope, confirmed live, not just unapproved).
 *   invites/, job-discovery/, reporting/, chat-monitoring/
 *                          Not yet built — each still a one-method stub
 *                          throwing ServiceUnavailableException, same
 *                          reasoning as before this refactor: shipping
 *                          unverified logic against Upwork's real API was
 *                          explicitly ruled out ("i cannot take any risk on
 *                          this one"). Each domain's turn follows the same
 *                          introspect-first discipline Connects usage and
 *                          Bidding/proposals already proved out, landing in
 *                          its own already-scaffolded module/folder, not
 *                          bolted onto an existing one.
 *
 * Every domain controller shares the same `@Controller("upwork-api")`
 * prefix and identical guard stack (JwtAuthGuard, RolesGuard,
 * ModuleAccessGuard, `@RequiresModule("UPWORK_API")`) — NestJS supports
 * multiple controllers under one path prefix as long as their own
 * sub-routes don't collide, so the public REST surface
 * (`/api/v1/upwork-api/...`) is byte-for-byte unchanged by this refactor;
 * only the internal module boundaries moved. Gated by the standard
 * upworkApiAccess module flag, same mechanism as every other module in this
 * app (originally hardcoded to one email, replaced per explicit user
 * request — "make the module an access option... rather than hardcoding
 * it").
 */
@Module({
  imports: [
    UpworkSharedModule,
    UpworkConnectionModule,
    UpworkConnectsUsageModule,
    UpworkProposalsModule,
    UpworkAgencyProfileModule,
    UpworkInvitesModule,
    UpworkJobDiscoveryModule,
    UpworkReportingModule,
    UpworkChatMonitoringModule,
  ],
})
export class UpworkIntegrationModule {}
