import { SetMetadata } from "@nestjs/common";

export const MODULE_ACCESS_KEY = "requiresModule";

export type AccessModule =
  | "LEAD_GENERATION"
  | "EMAIL_HUB"
  | "SOCIAL_MEDIA"
  | "SOCIAL_ENGAGEMENT"
  | "UPWORK"
  | "UPWORK_REQUESTS"
  | "META_ADS"
  | "UPWORK_API"
  | "UPWORK_PROPOSAL_WRITING"
  // Persistent shared LinkedIn browser session (Part: LinkedIn Outreach) —
  // gates /linkedin-outreach's claim/release/input endpoints.
  | "LINKEDIN_OUTREACH"
  // Per-page granularity inside the "Upwork Agency" sidebar group (Part:
  // Upwork API integration — per-module access, 2026-10-23) — independent
  // of UPWORK_API above, which now only backs the handful of domain
  // controllers with no sidebar page of their own.
  | "UPWORK_AGENCY_OVERVIEW"
  | "UPWORK_AGENCY_ORGANIZATION"
  | "UPWORK_AGENCY_TRANSACTIONS"
  | "UPWORK_AGENCY_BIDDING"
  | "UPWORK_AGENCY_INVITES"
  | "UPWORK_AGENCY_CONTRACT_PROPOSALS"
  | "UPWORK_AGENCY_SUBMIT_PROPOSAL"
  | "UPWORK_AGENCY_WORK_HISTORY"
  | "UPWORK_AGENCY_FREELANCERS"
  | "UPWORK_AGENCY_ROOMS"
  | "UPWORK_AGENCY_JOBS"
  | "UPWORK_AGENCY_ONTOLOGY"
  | "UPWORK_AGENCY_CONNECTION"
  // Per-tab Dashboard Center visibility (Part: Dashboard Center per-user
  // access, 2026-10-21) — independent of the module flags above; these gate
  // the cross-team BI tabs under /dashboards, not the underlying feature
  // pages those tabs summarize.
  | "DASHBOARD_OVERVIEW"
  | "DASHBOARD_LEADS"
  | "DASHBOARD_EMAIL"
  | "DASHBOARD_INBOX"
  | "DASHBOARD_SOCIAL"
  | "DASHBOARD_UPWORK"
  | "DASHBOARD_META_ADS"
  | "DASHBOARD_WEBSITE_ANALYTICS"
  | "DASHBOARD_PIPELINE"
  | "DASHBOARD_TEAM"
  | "DASHBOARD_ACTIVITY"
  | "DASHBOARD_BENCHMARKS";

/** Attach to a controller/route: @RequiresModule("EMAIL_HUB"). Enforced by
 *  ModuleAccessGuard. Pass an array for OR semantics — access.
 *  ANY one of the listed modules is enough (Part: narrow Social Inbox +
 *  Engagement-only access, 2026-09-07) — SocialInboxController/
 *  SocialEngagementController use @RequiresModule(["SOCIAL_MEDIA",
 *  "SOCIAL_ENGAGEMENT"]) so a person with either the broad Social Media
 *  grant OR just the narrow Engagement-only grant can reach them, while
 *  the rest of the Social Media Hub stays on "SOCIAL_MEDIA" alone. */
export const RequiresModule = (module: AccessModule | AccessModule[]) => SetMetadata(MODULE_ACCESS_KEY, module);
