/**
 * Where to land a user right after login (or whenever they hit a route
 * that turns out to be a dead end for them) — the first module they can
 * ACTUALLY use, in the same priority order the sidebar renders its
 * workspaces (Part: landing-route fix, 2026-10-27, explicit user request —
 * "when I check one thing for a person, only that module should be shown
 * to him without any error"). Previously both the login page and the root
 * route ("/") hardcoded `router.push("/dashboards")`/`redirect("/dashboards")`
 * unconditionally — fine for an admin/manager, but anyone whose only grant
 * was e.g. Social Media (no Dashboard Center tab) landed on a dead-end
 * "you don't have permission for this tab" screen instead of the module
 * they actually had. Admins always go to `/dashboards`, matching every
 * other access check's own ADMIN bypass (ModuleAccessGuard, flagGranted in
 * sidebar-nav.tsx, etc.).
 */
export function getDefaultRoute(flags: Record<string, unknown>, isAdmin: boolean): string {
  if (isAdmin) return "/dashboards";

  const has = (key: string) => flags[key] === true;
  const hasAny = (prefix: string) => Object.keys(flags).some((k) => k.startsWith(prefix) && k.endsWith("Access") && flags[k] === true);

  if (has("leadGenAccess")) return "/leads";
  if (has("emailHubAccess")) return "/email-hub";
  if (has("socialMediaAccess")) return "/social-media/accounts";
  if (has("socialEngagementAccess")) return "/social-engagement";
  if (has("upworkBiddingAccess")) return "/upwork/bidding";
  if (has("upworkInviteAccess")) return "/upwork/invite";
  if (has("upworkRequestsAccess")) return "/upwork/requests";
  if (has("upworkProposalWritingAccess")) return "/upwork/proposal-writing";
  if (has("metaAdsAccess")) return "/meta-ads/campaigns";
  if (hasAny("upworkAgency")) return "/upwork-agency";
  if (hasAny("dashboard")) return "/dashboards";

  // Nothing granted at all — land on the one page every authenticated user
  // can always see regardless of module flags (their own profile), not a
  // scary permission error. The real fix for this case is an admin
  // granting something in Settings > Team > Access, not a better fallback
  // route; this just avoids a dead end while that happens.
  return "/profile";
}
