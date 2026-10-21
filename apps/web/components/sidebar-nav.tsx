"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getCurrentUser } from "../lib/api-client";
import { useRealtimeRefetch } from "../lib/realtime";

interface NavLink {
  href: string;
  label: string;
  /** Exact-match override for links that share a pathname and differ only by
   *  query string (the Email Hub's view switcher) — plain startsWith would
   *  make every one of those links show active at once. */
  matchSearch?: string;
  /** Which field of GET /email-hub/stats this link's unread badge reads
   *  (Part: reliability overhaul, 2026-08-31) — e.g. "unread" for Unified
   *  Inbox. Omitted for links with no meaningful unread count (Leads,
   *  Follow-ups, Sent, Settings). */
  countKey?: "unread" | "important" | "ignored";
  /** Nested links shown in a collapsible sub-list under this one (Part:
   *  Social Media nav reorg, 2026-09-30) — e.g. "Accounts" expands to the
   *  individual platform pages. Clicking the row itself still navigates to
   *  `href`; a separate chevron toggles the sub-list open/closed.
   *  `socialPlatform` (Part: Social Inbox removal / per-module messaging,
   *  2026-10-21) drives that child's own unread badge from the per-platform
   *  breakdown GET /social-inbox/stats now returns — independent of
   *  `countKey` above, which only ever read the Email Hub stats shape. */
  children?: { href: string; label: string; socialPlatform?: "FACEBOOK" | "INSTAGRAM" | "LINKEDIN" | "WHATSAPP" }[];
  /** Per-link access, independent of the group's own moduleFlag (Part:
   *  Upwork Requests, 2026-10-01, explicit user request — "not everyone
   *  needs everything... hide bidding and invites for them"). Only the
   *  Upwork Proposals group's three links use this; every other group gates
   *  all its links uniformly via MODULE_FLAG_BY_GROUP instead. When set, a
   *  link is hidden unless this flag (or any flag, for an array) is true —
   *  the group header itself then only shows if at least one child link
   *  survives this filtering (see filterItems below). */
  moduleFlag?: ModuleFlag | ModuleFlag[];
}

type ModuleFlag =
  | "leadGenAccess"
  | "emailHubAccess"
  | "socialMediaAccess"
  | "socialEngagementAccess"
  | "upworkAccess"
  | "upworkBiddingAccess"
  | "upworkInviteAccess"
  | "upworkRequestsAccess"
  | "metaAdsAccess"
  | "upworkApiAccess"
  | "upworkProposalWritingAccess"
  | "dashboardOverviewAccess"
  | "dashboardLeadsAccess"
  | "dashboardEmailAccess"
  | "dashboardInboxAccess"
  | "dashboardSocialAccess"
  | "dashboardUpworkAccess"
  | "dashboardMetaAdsAccess"
  | "dashboardWebsiteAnalyticsAccess"
  | "dashboardPipelineAccess"
  | "dashboardTeamAccess"
  | "dashboardActivityAccess"
  | "dashboardBenchmarksAccess";

type NavItem =
  // moduleFlag accepts an array for OR semantics (Part: narrow Social Inbox
  // + Engagement-only access, 2026-09-07), matching ModuleAccessGuard's own
  // OR handling for an array passed to @RequiresModule -- no current
  // top-level entry uses more than one flag, but the guard/backend still
  // supports it for a future narrow-access grant.
  | {
      type: "link";
      href: string;
      label: string;
      moduleFlag?: ModuleFlag | ModuleFlag[];
      requiresPrimaryAdmin?: boolean;
      /** Restricts this link to specific roles, independent of moduleFlag
       *  (Part: Dashboard Center access fix, 2026-10-01, explicit user
       *  request — "the team is able to see the dashboards, but are not
       *  able to see the content in it... make sure that they don't see
       *  it"). Dashboard Center has no module-access flag at all — it's
       *  gated purely by role on the backend (DashboardCenterController's
       *  @Roles), so the nav link needs the same role check or every other
       *  role reaches a shell whose API calls all 403. */
      allowedRoles?: string[];
    }
  | { type: "group"; label: string; links: NavLink[] };

/** One icon-rail entry (Part: EBOS-inspired shell redesign, 2026-10-21,
 *  explicit user request — "go check [EBOS's] navigation panel and UI...
 *  make my outly ui exactly like this one"). Each workspace buckets several
 *  of the app's existing nav groups under one rail icon; clicking the icon
 *  swaps the whole second panel to that workspace's own items and navigates
 *  to its defaultHref, same behavior observed in EBOS (e.g. its "Projects"
 *  icon jumps straight to Time Tracker). Deliberately keeps Outly's existing
 *  orange accent (explicit user decision, not EBOS's teal) and copies only
 *  the structural pattern, not the color. */
interface Workspace {
  id: string;
  label: string;
  icon: (props: { className?: string }) => JSX.Element;
  defaultHref: string;
  items: NavItem[];
}

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M3 11.5 12 4l9 7.5M5.5 10v9a1 1 0 0 0 1 1H10v-5.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V20h3.5a1 1 0 0 0 1-1v-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function LeadsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" strokeLinecap="round" />
    </svg>
  );
}
function InboxIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.3-.67L3 21l1.67-6.2A8.5 8.5 0 1 1 21 11.5z" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
function UpworkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="3.5" y="7.5" width="17" height="12" rx="1.5" />
      <path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5" strokeLinecap="round" />
    </svg>
  );
}
function AdsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M3 10v4a1 1 0 0 0 1 1h2l8 4V5L6 9H4a1 1 0 0 0-1 1z" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M18 9a4 4 0 0 1 0 6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The dashboard's information architecture (Part: EBOS-inspired shell
 * redesign, 2026-10-21 — grouping these into icon-rail "workspaces" on top
 * of Part: Overall Dashboard Structure's original flat-list design). Every
 * group/link below is copied verbatim from the pre-redesign NAV array —
 * this buckets existing nav data into workspaces, it does not change what
 * any group contains or how it's gated.
 */
const WORKSPACES: Workspace[] = [
  {
    id: "home",
    label: "Home",
    icon: HomeIcon,
    defaultHref: "/dashboards",
    items: [
      {
        type: "link",
        href: "/dashboards",
        label: "Dashboard Center",
        allowedRoles: ["ADMIN", "MANAGER", "BUSINESS_DEVELOPER"],
        moduleFlag: [
          "dashboardOverviewAccess",
          "dashboardLeadsAccess",
          "dashboardEmailAccess",
          "dashboardInboxAccess",
          "dashboardSocialAccess",
          "dashboardUpworkAccess",
          "dashboardMetaAdsAccess",
          "dashboardWebsiteAnalyticsAccess",
          "dashboardPipelineAccess",
          "dashboardTeamAccess",
          "dashboardActivityAccess",
          "dashboardBenchmarksAccess",
        ],
      },
    ],
  },
  {
    id: "leads",
    label: "Leads",
    icon: LeadsIcon,
    defaultHref: "/leads",
    items: [
      { type: "group", label: "Lead Room", links: [{ href: "/leads", label: "Leads" }] },
      {
        type: "group",
        label: "Lead Generation",
        links: [
          { href: "/pipeline", label: "Pipeline" },
          { href: "/sequences", label: "Sequences" },
          { href: "/campaigns", label: "Campaigns" },
          { href: "/analytics", label: "Analytics" },
          { href: "/automation", label: "Automation" },
          { href: "/settings/lead-generation", label: "Settings" },
        ],
      },
    ],
  },
  {
    id: "inbox",
    label: "Inbox",
    icon: InboxIcon,
    defaultHref: "/email-hub",
    items: [
      {
        type: "group",
        label: "Email Hub",
        links: [
          { href: "/email-hub", label: "Unified Inbox", matchSearch: "", countKey: "unread" },
          { href: "/email-hub?view=important", label: "Important", matchSearch: "view=important", countKey: "important" },
          { href: "/email-hub?view=leads", label: "Leads", matchSearch: "view=leads" },
          { href: "/email-hub?view=followups", label: "Follow-ups", matchSearch: "view=followups" },
          { href: "/email-hub?view=ignored", label: "Ignored", matchSearch: "view=ignored", countKey: "ignored" },
          { href: "/email-hub?view=sent", label: "Sent", matchSearch: "view=sent" },
          { href: "/email-hub?view=tracked", label: "Tracked", matchSearch: "view=tracked" },
          { href: "/settings/email-hub", label: "Settings" },
        ],
      },
      // Engagement (Social Engagement Center) nav entry intentionally
      // removed (2026-09-30) -- no current requirement; the page/backend/
      // sync worker are untouched, just not linked.
      {
        type: "group",
        label: "Social Media",
        links: [
          // The centralized Social Inbox page was removed (Part: Social
          // Inbox removal / per-module messaging, 2026-10-21) — each
          // platform page below now has its own Inbox/Feed tabs instead.
          {
            href: "/social-media/accounts",
            label: "Accounts",
            children: [
              { href: "/social-media/linkedin", label: "LinkedIn", socialPlatform: "LINKEDIN" },
              { href: "/social-media/instagram", label: "Instagram", socialPlatform: "INSTAGRAM" },
              { href: "/social-media/facebook", label: "Facebook", socialPlatform: "FACEBOOK" },
              { href: "/social-media/whatsapp", label: "WhatsApp", socialPlatform: "WHATSAPP" },
            ],
          },
          { href: "/social-media/calendar", label: "Calendar" },
          { href: "/social-media/analytics", label: "Analytics" },
          { href: "/social-media/automations", label: "Automations" },
          { href: "/settings/social-media", label: "Settings" },
        ],
      },
    ],
  },
  {
    id: "upwork",
    label: "Upwork",
    icon: UpworkIcon,
    defaultHref: "/upwork/bidding",
    items: [
      {
        type: "group",
        label: "Upwork Proposals",
        // Each link gated by its own flag, not the group as a whole (Part:
        // Upwork Requests, 2026-10-01) -- see NavLink's own moduleFlag
        // docblock.
        links: [
          { href: "/upwork/bidding", label: "Bidding", moduleFlag: "upworkBiddingAccess" },
          { href: "/upwork/invite", label: "Invite", moduleFlag: "upworkInviteAccess" },
          { href: "/upwork/requests", label: "Requests", moduleFlag: "upworkRequestsAccess" },
          { href: "/upwork/proposal-writing", label: "Proposal Writing", moduleFlag: "upworkProposalWritingAccess" },
          { href: "/upwork/job-feed", label: "Job Feed", moduleFlag: "upworkProposalWritingAccess" },
        ],
      },
      // Standard module-flag gate (Part: Upwork API integration,
      // 2026-10-12) -- folded into this workspace instead of a standalone
      // top-level link (Part: EBOS-inspired shell redesign, 2026-10-21).
      { type: "link", href: "/settings/upwork-api", label: "Upwork API", moduleFlag: "upworkApiAccess" },
    ],
  },
  {
    id: "ads",
    label: "Ads",
    icon: AdsIcon,
    defaultHref: "/meta-ads/campaigns",
    items: [
      {
        type: "group",
        label: "Meta Ads",
        links: [
          // Overview moved into the Dashboard Center's own Meta Ads tab
          // (Part: Dashboard Center tab consolidation, 2026-09-30).
          { href: "/meta-ads/campaigns", label: "Campaigns" },
          { href: "/meta-ads/adsets", label: "Ad Sets" },
          { href: "/meta-ads/ads", label: "Ads" },
          { href: "/settings/meta-ads", label: "Settings" },
        ],
      },
    ],
  },
];

/** Maps a group's label to the module flag from GET /users/me that gates it. */
const MODULE_FLAG_BY_GROUP: Record<string, ModuleFlag> = {
  "Lead Room": "leadGenAccess",
  "Lead Generation": "leadGenAccess",
  "Email Hub": "emailHubAccess",
  "Social Media": "socialMediaAccess",
  // Upwork Proposals deliberately has no entry here (Part: Upwork Requests,
  // 2026-10-01) -- each of its three links carries its own moduleFlag
  // instead; the group's own visibility is derived from whether any child
  // link survives per-link filtering, not from a single flag here.
  "Meta Ads": "metaAdsAccess",
};

function isActive(pathname: string | null, search: string, link: NavLink): boolean {
  const [linkPath] = link.href.split(/[?#]/);
  if (pathname !== linkPath) return false;
  if (link.matchSearch === undefined) return true;
  return search === link.matchSearch;
}

/** Whether `pathname` belongs to this workspace at all (Part: EBOS-inspired
 *  shell redesign, 2026-10-21) — checked against every link/child href
 *  across the workspace's items, ignoring query strings (a path match is
 *  enough to pick the workspace; matchSearch only matters for highlighting
 *  the exact active link inside it). */
function workspaceContainsPath(ws: Workspace, pathname: string | null): boolean {
  if (!pathname) return false;
  for (const item of ws.items) {
    if (item.type === "link") {
      if (item.href === pathname) return true;
    } else {
      for (const link of item.links) {
        if (link.href.split(/[?#]/)[0] === pathname) return true;
        if (link.children?.some((c) => c.href === pathname)) return true;
      }
    }
  }
  return false;
}

export function SidebarNav({
  mobileOpen,
  onMobileClose,
}: {
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? "";
  const queryClient = useQueryClient();

  // null = still loading (or fetch failed) — default every module visible in
  // that case so there's no flash-of-empty-sidebar; the backend's
  // ModuleAccessGuard is what actually enforces this either way, this is UX
  // discoverability only.
  const [moduleAccess, setModuleAccess] = useState<Record<string, boolean> | null>(null);
  // Fails CLOSED, unlike moduleAccess above — System Logs must never flash
  // visible to a non-admin even briefly while /users/me is loading (Part:
  // Admin/System Logs, 2026-08-31 — "hidden from unauthorized users" is the
  // point, unlike the other three flags where fail-open is fine).
  const [isPrimaryAdmin, setIsPrimaryAdmin] = useState(false);

  useEffect(() => {
    api
      .getMe()
      .then((me) => {
        const m = me as {
          leadGenAccess: boolean;
          emailHubAccess: boolean;
          socialMediaAccess: boolean;
          socialEngagementAccess: boolean;
          upworkAccess: boolean;
          upworkBiddingAccess: boolean;
          upworkInviteAccess: boolean;
          upworkRequestsAccess: boolean;
          metaAdsAccess: boolean;
          upworkApiAccess: boolean;
          upworkProposalWritingAccess: boolean;
          dashboardOverviewAccess: boolean;
          dashboardLeadsAccess: boolean;
          dashboardEmailAccess: boolean;
          dashboardInboxAccess: boolean;
          dashboardSocialAccess: boolean;
          dashboardUpworkAccess: boolean;
          dashboardMetaAdsAccess: boolean;
          dashboardWebsiteAnalyticsAccess: boolean;
          dashboardPipelineAccess: boolean;
          dashboardTeamAccess: boolean;
          dashboardActivityAccess: boolean;
          dashboardBenchmarksAccess: boolean;
          isPrimaryAdmin: boolean;
        };
        setModuleAccess({
          leadGenAccess: m.leadGenAccess,
          emailHubAccess: m.emailHubAccess,
          socialMediaAccess: m.socialMediaAccess,
          socialEngagementAccess: m.socialEngagementAccess,
          upworkAccess: m.upworkAccess,
          upworkBiddingAccess: m.upworkBiddingAccess,
          upworkInviteAccess: m.upworkInviteAccess,
          upworkRequestsAccess: m.upworkRequestsAccess,
          metaAdsAccess: m.metaAdsAccess,
          upworkApiAccess: m.upworkApiAccess,
          upworkProposalWritingAccess: m.upworkProposalWritingAccess,
          dashboardOverviewAccess: m.dashboardOverviewAccess,
          dashboardLeadsAccess: m.dashboardLeadsAccess,
          dashboardEmailAccess: m.dashboardEmailAccess,
          dashboardInboxAccess: m.dashboardInboxAccess,
          dashboardSocialAccess: m.dashboardSocialAccess,
          dashboardUpworkAccess: m.dashboardUpworkAccess,
          dashboardMetaAdsAccess: m.dashboardMetaAdsAccess,
          dashboardWebsiteAnalyticsAccess: m.dashboardWebsiteAnalyticsAccess,
          dashboardPipelineAccess: m.dashboardPipelineAccess,
          dashboardTeamAccess: m.dashboardTeamAccess,
          dashboardActivityAccess: m.dashboardActivityAccess,
          dashboardBenchmarksAccess: m.dashboardBenchmarksAccess,
        });
        setIsPrimaryAdmin(m.isPrimaryAdmin);
      })
      .catch(() => {});
  }, []);

  // Same query key as the Email Hub page's own stats query — one cache
  // entry, so this badge and that page's stats strip never disagree (Part:
  // reliability overhaul, 2026-08-31 — nav items previously showed no count
  // at all). Only fetched once module access is confirmed, to avoid a 403
  // for a user without Email Hub access.
  const statsQuery = useQuery({
    queryKey: ["email-stats"],
    queryFn: () => api.getEmailHubStats() as Promise<{ unread: number; important: number; ignored: number }>,
    enabled: Boolean(moduleAccess?.emailHubAccess),
  });
  useRealtimeRefetch(
    ["emailHub.messageReceived", "emailHub.messagesUpdated"],
    () => queryClient.invalidateQueries({ queryKey: ["email-stats"] }),
  );
  const stats = statsQuery.data;

  // Same query key the platform pages' own Inbox tab uses (PlatformInbox /
  // ConversationDetailPanel invalidate "social-inbox-stats") — one cache
  // entry, so this badge and that tab's own numbers never disagree (Part:
  // Social Inbox removal / per-module messaging, 2026-10-21).
  const socialStatsQuery = useQuery({
    queryKey: ["social-inbox-stats"],
    queryFn: () => api.getSocialInboxStats() as Promise<{ unread: number; byPlatform: Record<string, number> }>,
    enabled: Boolean(moduleAccess?.socialMediaAccess),
  });
  useRealtimeRefetch(
    ["socialInbox.messageReceived", "socialInbox.conversationUpdated"],
    () => queryClient.invalidateQueries({ queryKey: ["social-inbox-stats"] }),
  );
  const socialStats = socialStatsQuery.data;

  function flagGranted(flag: ModuleFlag | ModuleFlag[] | undefined): boolean {
    if (!flag || !moduleAccess) return true;
    // ADMIN bypass (Part: same-day correction — the backend's
    // ModuleAccessGuard already bypasses Role.ADMIN unconditionally for
    // every module flag; this nav-visibility check never mirrored that, so
    // a brand-new module defaulting its flag to false hid the link from
    // admins too, including the org's own owner, until someone manually
    // toggled it on — not the intent). Matches the backend exactly: an
    // admin's real access was never actually gated by these flags, only
    // what the sidebar showed was.
    if (getCurrentUser()?.role === "ADMIN") return true;
    // Array means OR: any one of the listed flags being granted is enough
    // (mirrors ModuleAccessGuard's own array handling on the backend).
    return Array.isArray(flag) ? flag.some((f) => moduleAccess[f]) : moduleAccess[flag];
  }

  function filterItems(items: NavItem[]): NavItem[] {
    return items
      .map((item) => {
        if (item.type !== "group") return item;
        // Per-link filtering (Part: Upwork Requests, 2026-10-01) -- a no-op
        // for every group whose links don't set their own moduleFlag.
        return { ...item, links: item.links.filter((l) => flagGranted(l.moduleFlag)) };
      })
      .filter((item) => {
        if (item.type === "link" && item.requiresPrimaryAdmin) return isPrimaryAdmin;
        if (item.type === "link" && item.allowedRoles) {
          const role = getCurrentUser()?.role;
          const roleOk = role ? item.allowedRoles.includes(role) : false;
          // OR'd with moduleFlag (Part: Dashboard Center per-user access,
          // 2026-10-21) -- a person outside allowedRoles but individually
          // granted at least one Dashboard Center tab still needs the link.
          return roleOk || flagGranted(item.moduleFlag);
        }
        if (item.type === "group") {
          const flag = MODULE_FLAG_BY_GROUP[item.label];
          // No single group-level flag (Upwork Proposals) -- show the
          // group iff at least one child link survived per-link filtering.
          if (!flag) return item.links.length > 0;
          return flagGranted(flag);
        }
        return flagGranted(item.moduleFlag);
      });
  }

  const visibleWorkspaces = WORKSPACES.map((ws) => ({ ...ws, items: filterItems(ws.items) })).filter(
    (ws) => ws.items.length > 0,
  );

  // Which workspace's panel is showing (Part: EBOS-inspired shell redesign,
  // 2026-10-21) — derived from pathname so a direct link/refresh/back-
  // button always lands on the right panel, but kept as real state (not a
  // pure derivation) so clicking a rail icon can switch the panel the
  // instant it's clicked, not only after navigation finishes.
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(
    () => visibleWorkspaces.find((ws) => workspaceContainsPath(ws, pathname))?.id ?? visibleWorkspaces[0]?.id,
  );
  useEffect(() => {
    const match = visibleWorkspaces.find((ws) => workspaceContainsPath(ws, pathname));
    if (match) setActiveWorkspaceId(match.id);
    // Only pathname should retrigger this -- visibleWorkspaces is recomputed
    // every render from the same (rarely-changing) access flags, and
    // including it would fight the optimistic click-set below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const activeWorkspace = visibleWorkspaces.find((ws) => ws.id === activeWorkspaceId) ?? visibleWorkspaces[0];
  const activeItems = activeWorkspace?.items ?? [];

  // Auto-expand whichever group contains the current page, so a direct link
  // or refresh never lands on a page whose group looks collapsed/unselected.
  // A link with children counts as "containing" the current page if either
  // the link itself or one of its children matches. Re-seeded whenever the
  // active workspace changes, same reasoning as the one-time init before.
  const [groupCollapsed, setGroupCollapsed] = useState<Record<string, boolean>>({});
  const [expandedLinks, setExpandedLinks] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const collapsed: Record<string, boolean> = {};
    const expanded: Record<string, boolean> = {};
    for (const item of activeItems) {
      if (item.type !== "group") continue;
      collapsed[item.label] = !item.links.some(
        (l) => isActive(pathname, search, l) || l.children?.some((c) => isActive(pathname, search, c)),
      );
      for (const link of item.links) {
        if (link.children) expanded[link.href] = link.children.some((c) => isActive(pathname, search, c));
      }
    }
    setGroupCollapsed((prev) => ({ ...collapsed, ...prev }));
    setExpandedLinks((prev) => ({ ...expanded, ...prev }));
    // Only re-seed when the workspace itself changes -- once open/closed by
    // the user, a group/sub-list shouldn't snap back on every pathname
    // change within the same workspace (e.g. switching Email Hub views).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId]);

  function renderPanel(onNavigate?: () => void) {
    return (
      <>
        {activeItems.map((item) => {
          if (item.type === "link") {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-fast ${
                  active ? "bg-primary sidebar-nav-active font-medium text-white shadow-sm" : "text-ink/65 hover:bg-ink/5 hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          }

          const isOpen = !groupCollapsed[item.label];
          return (
            <div key={item.label} className="flex flex-col">
              <button
                type="button"
                onClick={() => setGroupCollapsed((c) => ({ ...c, [item.label]: !c[item.label] }))}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-label uppercase text-ink/50 transition-colors duration-fast hover:text-ink/80"
              >
                <span className="flex items-center gap-1.5">
                  {item.label}
                  {/* Group-level aggregate badge (Part: Social Inbox removal
                      / per-module messaging, 2026-10-21) — only the Social
                      Media group has a social-platform unread total today;
                      a no-op span for every other group. */}
                  {item.label === "Social Media" && (socialStats?.unread ?? 0) > 0 && (
                    <span className="tabular rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold normal-case text-primary">
                      {(socialStats?.unread ?? 0) > 99 ? "99+" : socialStats?.unread}
                    </span>
                  )}
                </span>
                <span aria-hidden className={`transition-transform duration-fast ${isOpen ? "rotate-90" : ""}`}>
                  ›
                </span>
              </button>
              {isOpen && (
                <div className="ml-1 flex flex-col gap-0.5 border-l border-[var(--line)] pl-2">
                  {item.links.map((link) => {
                    const active = isActive(pathname, search, link);
                    const count = link.countKey ? stats?.[link.countKey] ?? 0 : 0;
                    const linkEl = (
                      <Link
                        href={link.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={`flex flex-1 items-center justify-between rounded-lg px-3 py-1.5 text-sm transition-colors duration-fast ${
                          active ? "bg-primary sidebar-nav-active font-medium text-white shadow-sm" : "text-ink/65 hover:bg-ink/5 hover:text-ink"
                        }`}
                      >
                        <span>{link.label}</span>
                        {count > 0 && (
                          <span
                            className={`tabular ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                              active ? "bg-white/25 text-white" : "bg-primary/15 text-primary"
                            }`}
                          >
                            {count > 99 ? "99+" : count}
                          </span>
                        )}
                      </Link>
                    );

                    // Sub-list (e.g. Accounts -> LinkedIn/Instagram/
                    // Facebook/WhatsApp).
                    if (!link.children) {
                      return (
                        <div key={link.href} className="nav-tick">
                          {linkEl}
                        </div>
                      );
                    }

                    const childOpen = Boolean(expandedLinks[link.href]);
                    return (
                      <div key={link.href} className="flex flex-col">
                        <div className="nav-tick flex items-center">
                          {linkEl}
                          <button
                            type="button"
                            onClick={() => setExpandedLinks((e) => ({ ...e, [link.href]: !e[link.href] }))}
                            aria-expanded={childOpen}
                            aria-label={`${childOpen ? "Collapse" : "Expand"} ${link.label}`}
                            className="flex items-center justify-center rounded-lg px-2 py-1.5 text-ink/50 transition-colors duration-fast hover:bg-ink/5 hover:text-ink/80"
                          >
                            <span aria-hidden className={`transition-transform duration-fast ${childOpen ? "rotate-90" : ""}`}>
                              ›
                            </span>
                          </button>
                        </div>
                        {childOpen && (
                          <div className="ml-1 flex flex-col gap-0.5 border-l border-[var(--line)] pl-2">
                            {link.children.map((child) => {
                              const childActive = isActive(pathname, search, child);
                              // Per-platform unread badge (Part: Social
                              // Inbox removal / per-module messaging,
                              // 2026-10-21).
                              const childCount = child.socialPlatform ? socialStats?.byPlatform?.[child.socialPlatform] ?? 0 : 0;
                              return (
                                <Link
                                  key={child.href}
                                  href={child.href}
                                  onClick={onNavigate}
                                  aria-current={childActive ? "page" : undefined}
                                  className={`nav-tick flex items-center justify-between rounded-lg px-3 py-1.5 text-sm transition-colors duration-fast ${
                                    childActive ? "bg-primary sidebar-nav-active font-medium text-white shadow-sm" : "text-ink/65 hover:bg-ink/5 hover:text-ink"
                                  }`}
                                >
                                  <span>{child.label}</span>
                                  {childCount > 0 && (
                                    <span
                                      className={`tabular ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                        childActive ? "bg-white/25 text-white" : "bg-primary/15 text-primary"
                                      }`}
                                    >
                                      {childCount > 99 ? "99+" : childCount}
                                    </span>
                                  )}
                                </Link>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </>
    );
  }

  /** The icon rail itself (Part: EBOS-inspired shell redesign, 2026-10-21) —
   *  solid accent fill (EBOS uses teal; this keeps Outly's own orange, per
   *  explicit user decision), accent-contrast text/icons for the same
   *  readability reason Tabs' active-state text already uses that token
   *  instead of plain white (see that component's own comment). "Inbox"
   *  gets an aggregate badge (Email Hub unread + Social Media unread) since
   *  it's the one workspace bundling two separately-badged groups. */
  function renderRail(onNavigate?: () => void) {
    const inboxBadge = (stats?.unread ?? 0) + (socialStats?.unread ?? 0);
    return (
      <div className="flex w-[68px] shrink-0 flex-col items-center gap-1 bg-accent py-3">
        {visibleWorkspaces.map((ws) => {
          const active = ws.id === activeWorkspaceId;
          const Icon = ws.icon;
          const badge = ws.id === "inbox" ? inboxBadge : 0;
          return (
            <Link
              key={ws.id}
              href={ws.defaultHref}
              onClick={() => {
                setActiveWorkspaceId(ws.id);
                onNavigate?.();
              }}
              title={ws.label}
              className={`relative flex w-14 flex-col items-center gap-1 rounded-xl py-2.5 text-[10px] font-medium transition-colors duration-fast ${
                active ? "bg-black/10 text-[rgb(var(--accent-contrast-rgb))]" : "text-[rgb(var(--accent-contrast-rgb))]/70 hover:bg-black/5"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{ws.label}</span>
              {badge > 0 && (
                <span className="tabular absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-bad px-1 text-[9px] font-semibold text-white">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    );
  }

  return (
    <>
      {/* Desktop: permanent icon rail + a second panel for the active
          workspace's own nav items. Hidden below md, where the mobile
          drawer below takes over instead. */}
      <div className="hidden h-full shrink-0 md:flex">
        {renderRail()}
        <nav className="relative flex h-full w-48 shrink-0 flex-col gap-1 overflow-y-auto border-r border-[var(--line)] p-3">
          <div className="relative z-10 flex flex-1 flex-col gap-1 overflow-y-auto">{renderPanel()}</div>
        </nav>
      </div>

      {/* Mobile: overlay + slide-over drawer, same rail+panel shape. */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-ink/40 backdrop-blur-[1px]" onClick={onMobileClose} aria-hidden />
          <div className="animate-slide-in-left absolute inset-y-0 left-0 flex shadow-lg">
            {renderRail(onMobileClose)}
            <nav className="flex w-56 flex-col gap-1 overflow-y-auto border-r border-[var(--line)] bg-surface p-3">
              <div className="relative z-10 flex flex-1 flex-col gap-1">{renderPanel(onMobileClose)}</div>
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
