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
  /** Nested links shown flat under this one (Part: Social Media nav reorg,
   *  2026-09-30) — e.g. "Accounts" expands to the individual platform pages.
   *  Clicking the row itself still navigates to `href`; the children render
   *  permanently visible beneath it (Part: EBOS-inspired shell redesign
   *  round 2, 2026-10-21 — the reference app has no collapse/expand toggle
   *  anywhere in its nav, so this no longer has one either).
   *  `socialPlatform` (Part: Social Inbox removal / per-module messaging,
   *  2026-10-21) drives that child's own unread badge from the per-platform
   *  breakdown GET /social-inbox/stats now returns — independent of
   *  `countKey` above, which only ever read the Email Hub stats shape. */
  children?: {
    href: string;
    label: string;
    socialPlatform?: "FACEBOOK" | "INSTAGRAM" | "LINKEDIN" | "WHATSAPP";
    icon?: (props: { className?: string }) => JSX.Element;
  }[];
  /** Small leading icon (Part: EBOS-inspired shell redesign round 2,
   *  2026-10-21, explicit user request — "check the dropdowns in the nav
   *  bar bec there are no dropdowns [in EBOS]... the nav bar is still not
   *  exactly like this") — EBOS gives every single leaf nav row its own
   *  icon; falls back to a plain dot in renderPanel if omitted rather than
   *  leaving a row with nothing (every row in the reference has one). */
  icon?: (props: { className?: string }) => JSX.Element;
  /** Per-link access, independent of the group's own moduleFlag (Part:
   *  Upwork Requests, 2026-10-01, explicit user request — "not everyone
   *  needs everything... hide bidding and invites for them"). Only the
   *  Upwork Proposals group's three links use this; every other group gates
   *  all its links uniformly via MODULE_FLAG_BY_GROUP instead. When set, a
   *  link is hidden unless this flag (or any flag, for an array) is true —
   *  the group header itself then only shows if at least one child link
   *  survives this filtering (see filterItems below). */
  moduleFlag?: ModuleFlag | ModuleFlag[];
  /** Same meaning as NavItem's own requiresPrimaryAdmin below, for a link
   *  nested inside a group (Part: Agency Tools, 2026-10-23) — overrides
   *  moduleFlag entirely when set; see filterItems' group-link filtering. */
  requiresPrimaryAdmin?: boolean;
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
  // Per-page granularity inside the "Upwork Agency" sidebar group (Part:
  // Upwork API integration — per-module access, 2026-10-23, explicit user
  // request — "I need separate access for each module in the Upwork
  // Agency tab, not everyone need the complete module").
  | "upworkAgencyOverviewAccess"
  | "upworkAgencyOrganizationAccess"
  | "upworkAgencyTransactionsAccess"
  | "upworkAgencyBiddingAccess"
  | "upworkAgencyInvitesAccess"
  | "upworkAgencyContractProposalsAccess"
  | "upworkAgencySubmitProposalAccess"
  | "upworkAgencyWorkHistoryAccess"
  | "upworkAgencyFreelancersAccess"
  | "upworkAgencyRoomsAccess"
  | "upworkAgencyJobsAccess"
  | "upworkAgencyOntologyAccess"
  | "upworkAgencyConnectionAccess"
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
      icon?: (props: { className?: string }) => JSX.Element;
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

/* Small leaf-row icons (Part: EBOS-inspired shell redesign round 2,
 * 2026-10-21, explicit user request — every individual nav row in EBOS has
 * its own line icon, not just the workspace rail). Deliberately thinner
 * stroke than the rail icons above so they read as secondary at the smaller
 * leaf-row size. */
function GridIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.2" />
    </svg>
  );
}
function UserIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" strokeLinecap="round" />
    </svg>
  );
}
function FunnelIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path d="M4 5h16l-6 7.5V19l-4 2v-8.5z" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
function LayersIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path d="M12 3.5 3.5 8 12 12.5 20.5 8z" strokeLinejoin="round" />
      <path d="M3.5 12 12 16.5 20.5 12M3.5 16l8.5 4.5L20.5 16" strokeLinejoin="round" />
    </svg>
  );
}
function MegaphoneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path d="M3 10v4a1 1 0 0 0 1 1h2l8 4V5L6 9H4a1 1 0 0 0-1 1z" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M18 9a4 4 0 0 1 0 6" strokeLinecap="round" />
    </svg>
  );
}
function ChartIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path d="M4 20V10M11 20V4M18 20v-7" strokeLinecap="round" />
    </svg>
  );
}
function BoltIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path d="M13 3 5 13h5l-1 8 8-10h-5z" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
function GearIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <circle cx="12" cy="12" r="3" />
      <path
        d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M17.8 6.2l-1.4 1.4M7.6 16.4l-1.4 1.4M17.8 17.8l-1.4-1.4M7.6 7.6 6.2 6.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
function MailIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="1.5" />
      <path d="m4.5 6.5 7.5 6 7.5-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function StarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path d="m12 3.5 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" strokeLinejoin="round" />
    </svg>
  );
}
function ClockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path
        d="M3.5 12S7 5.5 12 5.5 20.5 12 20.5 12 17 18.5 12 18.5 3.5 12 3.5 12Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M4 20 20 4" strokeLinecap="round" />
    </svg>
  );
}
function SendIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path d="M20.5 3.5 10.5 13.5M20.5 3.5 14 20.5l-3.5-7-7-3.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function EyeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path
        d="M3.5 12S7 5.5 12 5.5 20.5 12 20.5 12 17 18.5 12 18.5 3.5 12 3.5 12Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}
function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="1.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" strokeLinecap="round" />
    </svg>
  );
}
function TagIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path d="M11.5 3.5H5a1.5 1.5 0 0 0-1.5 1.5v6.5l10 10 8-8-10-10Z" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx="8" cy="8" r="1.5" />
    </svg>
  );
}
function ImageIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m5 18 5-5 4 3 3-3.5 3.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function DollarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path d="M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 2.6 4.5 3 4.5 1.3 4.5 3-2 3-4.5 3-4.5-1.3-4.5-3" strokeLinecap="round" />
    </svg>
  );
}
function ClipboardIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <rect x="5" y="4.5" width="14" height="16" rx="1.5" />
      <rect x="8.5" y="3" width="7" height="3" rx="1" />
      <path d="M8.5 11.5h7M8.5 15.5h7" strokeLinecap="round" />
    </svg>
  );
}
function FileIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
      <path d="M14 3.5V8h4" strokeLinejoin="round" />
    </svg>
  );
}
function RssIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path d="M4.5 4.5a15 15 0 0 1 15 15M4.5 10.5a9 9 0 0 1 9 9" strokeLinecap="round" />
      <circle cx="5.5" cy="18.5" r="1.6" />
    </svg>
  );
}
function PlugIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path d="M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 18v3" strokeLinecap="round" />
    </svg>
  );
}
function ChatIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.3-.67L3 21l1.67-6.2A8.5 8.5 0 1 1 21 11.5z" strokeLinejoin="round" strokeLinecap="round" />
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
        icon: GridIcon,
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
      { type: "group", label: "Lead Room", links: [{ href: "/leads", label: "Leads", icon: UserIcon }] },
      {
        type: "group",
        label: "Lead Generation",
        links: [
          { href: "/pipeline", label: "Pipeline", icon: FunnelIcon },
          { href: "/sequences", label: "Sequences", icon: LayersIcon },
          { href: "/campaigns", label: "Campaigns", icon: MegaphoneIcon },
          { href: "/analytics", label: "Analytics", icon: ChartIcon },
          { href: "/automation", label: "Automation", icon: BoltIcon },
          { href: "/settings/lead-generation", label: "Settings", icon: GearIcon },
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
          { href: "/email-hub", label: "Unified Inbox", matchSearch: "", countKey: "unread", icon: MailIcon },
          { href: "/email-hub?view=important", label: "Important", matchSearch: "view=important", countKey: "important", icon: StarIcon },
          { href: "/email-hub?view=leads", label: "Leads", matchSearch: "view=leads", icon: UserIcon },
          { href: "/email-hub?view=followups", label: "Follow-ups", matchSearch: "view=followups", icon: ClockIcon },
          { href: "/email-hub?view=ignored", label: "Ignored", matchSearch: "view=ignored", countKey: "ignored", icon: EyeOffIcon },
          { href: "/email-hub?view=sent", label: "Sent", matchSearch: "view=sent", icon: SendIcon },
          { href: "/email-hub?view=tracked", label: "Tracked", matchSearch: "view=tracked", icon: EyeIcon },
          { href: "/settings/email-hub", label: "Settings", icon: GearIcon },
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
            icon: UserIcon,
            children: [
              { href: "/social-media/linkedin", label: "LinkedIn", socialPlatform: "LINKEDIN", icon: ChatIcon },
              { href: "/social-media/instagram", label: "Instagram", socialPlatform: "INSTAGRAM", icon: ChatIcon },
              { href: "/social-media/facebook", label: "Facebook", socialPlatform: "FACEBOOK", icon: ChatIcon },
              { href: "/social-media/whatsapp", label: "WhatsApp", socialPlatform: "WHATSAPP", icon: ChatIcon },
            ],
          },
          { href: "/social-media/calendar", label: "Calendar", icon: CalendarIcon },
          { href: "/social-media/analytics", label: "Analytics", icon: ChartIcon },
          { href: "/social-media/automations", label: "Automations", icon: BoltIcon },
          { href: "/settings/social-media", label: "Settings", icon: GearIcon },
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
          { href: "/upwork/bidding", label: "Bidding", moduleFlag: "upworkBiddingAccess", icon: DollarIcon },
          { href: "/upwork/invite", label: "Invite", moduleFlag: "upworkInviteAccess", icon: SendIcon },
          { href: "/upwork/requests", label: "Requests", moduleFlag: "upworkRequestsAccess", icon: ClipboardIcon },
          { href: "/upwork/proposal-writing", label: "Proposal Writing", moduleFlag: "upworkProposalWritingAccess", icon: FileIcon },
          {
            href: "/upwork/proposal-writing/invite",
            label: "Invite Proposal Writing",
            moduleFlag: "upworkProposalWritingAccess",
            icon: MailIcon,
          },
        ],
      },
      // Dedicated per-domain routes (Part: Upwork API integration --
      // enterprise module build-out, 2026-10-23), each now gated by its
      // OWN flag (Part: per-module access, 2026-10-23, explicit user
      // request — "I need separate access for each module in the Upwork
      // Agency tab") instead of one shared upworkApiAccess for the whole
      // group.
      {
        type: "group",
        label: "Upwork Agency",
        links: [
          { href: "/upwork-agency", label: "Overview", moduleFlag: "upworkAgencyOverviewAccess", icon: GridIcon },
          { href: "/upwork-agency/organization", label: "Organization", moduleFlag: "upworkAgencyOrganizationAccess", icon: PlugIcon },
          { href: "/upwork-agency/transactions", label: "Transactions", moduleFlag: "upworkAgencyTransactionsAccess", icon: ChartIcon },
          { href: "/upwork-agency/bidding", label: "Bidding & Proposals", moduleFlag: "upworkAgencyBiddingAccess", icon: FileIcon },
          { href: "/upwork-agency/invites", label: "Invites", moduleFlag: "upworkAgencyInvitesAccess", icon: SendIcon },
          { href: "/upwork-agency/contract-proposals", label: "Contract Proposals", moduleFlag: "upworkAgencyContractProposalsAccess", icon: ClipboardIcon },
          { href: "/upwork-agency/submit-proposal", label: "Submit Proposal", moduleFlag: "upworkAgencySubmitProposalAccess", icon: StarIcon },
          { href: "/upwork-agency/work-history", label: "Work History", moduleFlag: "upworkAgencyWorkHistoryAccess", icon: ClockIcon },
          { href: "/upwork-agency/freelancers", label: "Freelancers", moduleFlag: "upworkAgencyFreelancersAccess", icon: UserIcon },
          { href: "/upwork-agency/rooms", label: "Rooms & Messages", moduleFlag: "upworkAgencyRoomsAccess", icon: ChatIcon },
          { href: "/upwork-agency/delayed-responses", label: "Delayed Responses", moduleFlag: "upworkAgencyRoomsAccess", icon: ClockIcon },
          { href: "/upwork-agency/jobs", label: "Marketplace Jobs", moduleFlag: "upworkAgencyJobsAccess", icon: RssIcon },
          { href: "/upwork-agency/ontology", label: "Ontology", moduleFlag: "upworkAgencyOntologyAccess", icon: TagIcon },
          // Agency Tools (Part: Upwork API integration, 2026-10-23) — real
          // capabilities found via live schema introspection, gated to the
          // primary admin only (not a module flag) per explicit user
          // request: "keep it to me for now, I'll see later whom to give
          // access... do not change any [access] settings". requiresPrimaryAdmin
          // bypasses the moduleFlag check entirely (see the filter below).
          { href: "/upwork-agency/talent-search", label: "Talent Search", requiresPrimaryAdmin: true, icon: UserIcon },
          { href: "/upwork-agency/work-diary", label: "Work Diary", requiresPrimaryAdmin: true, icon: EyeIcon },
          { href: "/upwork-agency/team-invite", label: "Team Invite", requiresPrimaryAdmin: true, icon: SendIcon },
          { href: "/settings/upwork-api", label: "Connection Settings", moduleFlag: "upworkAgencyConnectionAccess", icon: GearIcon },
        ],
      },
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
          { href: "/meta-ads/campaigns", label: "Campaigns", icon: MegaphoneIcon },
          { href: "/meta-ads/adsets", label: "Ad Sets", icon: TagIcon },
          { href: "/meta-ads/ads", label: "Ads", icon: ImageIcon },
          { href: "/settings/meta-ads", label: "Settings", icon: GearIcon },
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
          upworkAgencyOverviewAccess: boolean;
          upworkAgencyOrganizationAccess: boolean;
          upworkAgencyTransactionsAccess: boolean;
          upworkAgencyBiddingAccess: boolean;
          upworkAgencyInvitesAccess: boolean;
          upworkAgencyContractProposalsAccess: boolean;
          upworkAgencySubmitProposalAccess: boolean;
          upworkAgencyWorkHistoryAccess: boolean;
          upworkAgencyFreelancersAccess: boolean;
          upworkAgencyRoomsAccess: boolean;
          upworkAgencyJobsAccess: boolean;
          upworkAgencyOntologyAccess: boolean;
          upworkAgencyConnectionAccess: boolean;
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
          upworkAgencyOverviewAccess: m.upworkAgencyOverviewAccess,
          upworkAgencyOrganizationAccess: m.upworkAgencyOrganizationAccess,
          upworkAgencyTransactionsAccess: m.upworkAgencyTransactionsAccess,
          upworkAgencyBiddingAccess: m.upworkAgencyBiddingAccess,
          upworkAgencyInvitesAccess: m.upworkAgencyInvitesAccess,
          upworkAgencyContractProposalsAccess: m.upworkAgencyContractProposalsAccess,
          upworkAgencySubmitProposalAccess: m.upworkAgencySubmitProposalAccess,
          upworkAgencyWorkHistoryAccess: m.upworkAgencyWorkHistoryAccess,
          upworkAgencyFreelancersAccess: m.upworkAgencyFreelancersAccess,
          upworkAgencyRoomsAccess: m.upworkAgencyRoomsAccess,
          upworkAgencyJobsAccess: m.upworkAgencyJobsAccess,
          upworkAgencyOntologyAccess: m.upworkAgencyOntologyAccess,
          upworkAgencyConnectionAccess: m.upworkAgencyConnectionAccess,
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
        // requiresPrimaryAdmin checked here too (Part: Agency Tools,
        // 2026-10-23) -- the top-level filter below only ever applied this
        // to standalone links outside a group (System Logs); nested group
        // links like Talent Search/Work Diary/Team Invite never reached
        // that check at all and would have shown to everyone.
        return {
          ...item,
          links: item.links.filter((l) => (l.requiresPrimaryAdmin ? isPrimaryAdmin : flagGranted(l.moduleFlag))),
        };
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

  /** Flat, always-expanded panel (Part: EBOS-inspired shell redesign round 2,
   *  2026-10-21, explicit user request — "check the dropdowns in the nav
   *  bar bec there are no dropdowns [in EBOS]... the nav bar is still not
   *  exactly like this"). Verified against the live EBOS reference: its
   *  secondary panel has zero collapse/expand interactions anywhere -- every
   *  section is a plain static label and every item list is always visible.
   *  Group headers below are now non-interactive (no button, no chevron) and
   *  "Accounts"' nested children render flat under it permanently instead of
   *  behind their own toggle. */
  function renderPanel(onNavigate?: () => void) {
    return (
      <>
        {activeItems.map((item) => {
          if (item.type === "link") {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded px-3 py-2 text-sm transition-colors duration-fast ${
                  active ? "sidebar-nav-active" : "text-ink/65 hover:bg-ink/5 hover:text-ink"
                }`}
              >
                {Icon && <Icon className="h-5 w-5 shrink-0" />}
                {item.label}
              </Link>
            );
          }

          return (
            <div key={item.label} className="flex flex-col">
              <div className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-label uppercase text-ink/50">
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
              </div>
              <div className="ml-1 flex flex-col gap-0.5 border-l border-[var(--line)] pl-2">
                {item.links.map((link) => {
                  const active = isActive(pathname, search, link);
                  const count = link.countKey ? stats?.[link.countKey] ?? 0 : 0;
                  const LinkIcon = link.icon;
                  const linkEl = (
                    <Link
                      href={link.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={`flex flex-1 items-center justify-between rounded-lg px-3 py-1.5 text-sm transition-colors duration-fast ${
                        active ? "sidebar-nav-active" : "text-ink/65 hover:bg-ink/5 hover:text-ink"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {LinkIcon && <LinkIcon className="h-5 w-5 shrink-0" />}
                        {link.label}
                      </span>
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

                  // Sub-list (e.g. Accounts -> LinkedIn/Instagram/Facebook/
                  // WhatsApp) -- always flat/visible now, no toggle.
                  if (!link.children) {
                    return (
                      <div key={link.href} className="nav-tick">
                        {linkEl}
                      </div>
                    );
                  }

                  return (
                    <div key={link.href} className="flex flex-col">
                      <div className="nav-tick flex items-center">{linkEl}</div>
                      <div className="ml-1 flex flex-col gap-0.5 border-l border-[var(--line)] pl-2">
                        {link.children.map((child) => {
                          const childActive = isActive(pathname, search, child);
                          // Per-platform unread badge (Part: Social Inbox
                          // removal / per-module messaging, 2026-10-21).
                          const childCount = child.socialPlatform ? socialStats?.byPlatform?.[child.socialPlatform] ?? 0 : 0;
                          const ChildIcon = child.icon;
                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              onClick={onNavigate}
                              aria-current={childActive ? "page" : undefined}
                              className={`nav-tick flex items-center justify-between rounded-lg px-3 py-1.5 text-sm transition-colors duration-fast ${
                                childActive ? "sidebar-nav-active" : "text-ink/65 hover:bg-ink/5 hover:text-ink"
                              }`}
                            >
                              <span className="flex items-center gap-2">
                                {ChildIcon && <ChildIcon className="h-5 w-5 shrink-0" />}
                                {child.label}
                              </span>
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
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </>
    );
  }

  /** The app-switcher rail (Part: full UI redesign per UI.md, 2026-10-23,
   *  Section 6.2) — 49px wide, flat `--rail-bg` gray (not a colored fill),
   *  icon-only 40x46px hit targets (the workspace label now only shows as
   *  a tooltip via `title`, matching the spec's own icon-only rail — it
   *  never shows text labels next to rail icons). Active workspace gets
   *  the spec's one reused "needs attention" rule: a 3px solid blue bar
   *  flush against the icon cell's left edge (Section 8, rule 1) instead
   *  of the previous filled/tinted pill. "Inbox" keeps its real aggregate
   *  unread badge (Email Hub + Social Media) — the spec doesn't show rail
   *  badges in Outlook's own Mail/Calendar icons, but this is genuine
   *  real-data functionality worth keeping, and a small flat corner badge
   *  doesn't conflict with anything the spec actually specifies. */
  function renderRail(onNavigate?: () => void) {
    const inboxBadge = (stats?.unread ?? 0) + (socialStats?.unread ?? 0);
    return (
      <div className="flex w-[49px] shrink-0 flex-col items-center gap-1 bg-[var(--rail-bg)] py-2">
        {visibleWorkspaces.map((ws) => {
          const active = ws.id === activeWorkspaceId;
          const Icon = ws.icon;
          const badge = ws.id === "inbox" ? inboxBadge : 0;
          return (
            <Link
              key={ws.id}
              href={ws.defaultHref}
              onClick={onNavigate}
              title={ws.label}
              className={`relative flex h-[46px] w-10 items-center justify-center rounded transition-colors duration-fast ${
                active ? "text-accent" : "text-[#424242] hover:bg-black/5"
              }`}
            >
              {active && <span aria-hidden className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r bg-accent" />}
              <Icon className="h-5 w-5" />
              {badge > 0 && (
                <span className="tabular absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-bad px-1 text-[9px] font-semibold text-white">
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
        <nav className="relative flex h-full w-[214px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-[var(--line)] p-3">
          <div className="relative z-10 flex flex-1 flex-col gap-1 overflow-y-auto">{renderPanel()}</div>
        </nav>
      </div>

      {/* Mobile: overlay + slide-over drawer, same rail+panel shape. */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-ink/40 backdrop-blur-[1px]" onClick={onMobileClose} aria-hidden />
          <div className="animate-slide-in-left absolute inset-y-0 left-0 flex shadow-lg">
            {renderRail(onMobileClose)}
            <nav className="flex w-[214px] flex-col gap-1 overflow-y-auto border-r border-[var(--line)] bg-paper p-3">
              <div className="relative z-10 flex flex-1 flex-col gap-1">{renderPanel(onMobileClose)}</div>
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
