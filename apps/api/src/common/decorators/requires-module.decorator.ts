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
