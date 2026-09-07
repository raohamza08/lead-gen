import { SetMetadata } from "@nestjs/common";

export const MODULE_ACCESS_KEY = "requiresModule";

export type AccessModule = "LEAD_GENERATION" | "EMAIL_HUB" | "SOCIAL_MEDIA" | "SOCIAL_ENGAGEMENT";

/** Attach to a controller/route: @RequiresModule("EMAIL_HUB"). Enforced by
 *  ModuleAccessGuard. Pass an array for OR semantics — access.
 *  ANY one of the listed modules is enough (Part: narrow Social Inbox +
 *  Engagement-only access, 2026-09-07) — SocialInboxController/
 *  SocialEngagementController use @RequiresModule(["SOCIAL_MEDIA",
 *  "SOCIAL_ENGAGEMENT"]) so a person with either the broad Social Media
 *  grant OR just the narrow Engagement-only grant can reach them, while
 *  the rest of the Social Media Hub stays on "SOCIAL_MEDIA" alone. */
export const RequiresModule = (module: AccessModule | AccessModule[]) => SetMetadata(MODULE_ACCESS_KEY, module);
