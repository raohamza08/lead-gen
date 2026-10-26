"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, getCurrentUser } from "../../../lib/api-client";
import { getDefaultRoute } from "../../../lib/default-route";
import { Tabs } from "../../../components/ui/tabs";
import { EmptyState } from "../../../components/ui/empty-state";
import { SkeletonCard } from "../../../components/ui/skeleton";
import { OverviewTab } from "./_tabs/overview";
import { LeadsTab } from "./_tabs/leads";
import { EmailTab } from "./_tabs/email";
import { InboxTab } from "./_tabs/inbox";
import { SocialTab } from "./_tabs/social";
import { UpworkTab } from "./_tabs/upwork";
import { MetaAdsTab } from "./_tabs/meta-ads";
import { PipelineTab } from "./_tabs/pipeline";
import { TeamTab } from "./_tabs/team";
import { ActivityTab } from "./_tabs/activity";
import { BenchmarksTab } from "./_tabs/benchmarks";
import { WebsiteAnalyticsTab } from "./_tabs/website-analytics";

/** Each tab's `value` maps to a DashboardAccessFlags key via FLAG_BY_TAB
 *  below — keep both in sync when adding a tab. */
const ALL_TAB_DEFS: { value: string; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "leads", label: "Leads" },
  { value: "email", label: "Email Campaigns" },
  { value: "inbox", label: "Unified Inbox" },
  { value: "social", label: "Social Inbox" },
  { value: "upwork", label: "Upwork" },
  // Embedded inline, same as every other tab (Part: Dashboard Center tab
  // consolidation, 2026-09-30 — "remove the meta ads overview and just keep
  // its dashboard in the dashboard center"). Campaigns/Ad Sets/Ads
  // drill-down pages and Settings stay separate real pages under the
  // sidebar's own Meta Ads group; only the Overview-level charts moved here.
  { value: "meta-ads", label: "Meta Ads" },
  { value: "website-analytics", label: "Website Analytics" },
  { value: "pipeline", label: "Pipeline" },
  { value: "team", label: "Team Performance" },
  { value: "activity", label: "Activity / Audit" },
  { value: "benchmarks", label: "Benchmarks" },
];

const DEFAULT_TAB = "overview";

interface DashboardAccessFlags {
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
}

const FLAG_BY_TAB: Record<string, keyof DashboardAccessFlags> = {
  overview: "dashboardOverviewAccess",
  leads: "dashboardLeadsAccess",
  email: "dashboardEmailAccess",
  inbox: "dashboardInboxAccess",
  social: "dashboardSocialAccess",
  upwork: "dashboardUpworkAccess",
  "meta-ads": "dashboardMetaAdsAccess",
  "website-analytics": "dashboardWebsiteAnalyticsAccess",
  pipeline: "dashboardPipelineAccess",
  team: "dashboardTeamAccess",
  activity: "dashboardActivityAccess",
  benchmarks: "dashboardBenchmarksAccess",
};

/**
 * Dashboard Center, unified (Part: Dashboard Center tab consolidation,
 * 2026-09-30 — "remove the dropdown menu ... take all its tabs to the tabs
 * view in one page"). Replaces both the old top-level "Dashboard" nav entry
 * and the Dashboard Center sidebar dropdown: every dashboard that used to be
 * its own route now lives here as an in-page tab, switched with no
 * navigation/full reload. The old routes (`/dashboards/leads` etc.) still
 * exist as thin redirects here (`?tab=leads`) so old bookmarks don't 404.
 * The active tab is in the URL (`?tab=`) so a direct link/bookmark/refresh
 * lands on the right one.
 */
function DashboardCenterTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isAdmin = getCurrentUser()?.role === "ADMIN";

  // Per-tab, per-user flags (Part: Dashboard Center per-user access,
  // 2026-10-21, explicit user request — "I want that i got option to show
  // different dashboard to different persons") replace the old hardcoded
  // FULL_ACCESS_ROLES/UPWORK_ONLY_ROLES role arrays. ADMIN still bypasses
  // (matches ModuleAccessGuard's own unconditional ADMIN bypass on the
  // backend) without waiting on this fetch. Fails CLOSED while loading —
  // unlike sidebar-nav's "default open" module flags, this page renders
  // real cross-team data, so a flash of tabs/content the person can't
  // actually load (then a yank once flags arrive) is worse than a brief
  // loading state.
  const flagsQuery = useQuery({
    queryKey: ["dc-my-dashboard-access"],
    queryFn: () => api.getMe() as Promise<DashboardAccessFlags & Record<string, unknown>>,
    enabled: !isAdmin,
  });

  const flags = flagsQuery.data;
  const tabDefs = isAdmin ? ALL_TAB_DEFS : ALL_TAB_DEFS.filter((t) => flags?.[FLAG_BY_TAB[t.value]]);

  // Someone with zero Dashboard Center tabs granted can only ever land
  // here via a hardcoded redirect (root "/" or just-logged-in) — the
  // sidebar's own "Dashboard Center" link never renders without at least
  // one of these flags, so nobody reaches this by clicking a visible nav
  // item. Send them to whatever module they DO have instead of a dead-end
  // permission error (Part: landing-route fix, 2026-10-27, explicit user
  // request — "when I check one thing for a person, only that module
  // should be shown to him without any error"). getDefaultRoute checks the
  // same flags this filtered to zero tabs, so it can never loop back here.
  useEffect(() => {
    if (!isAdmin && flags && tabDefs.length === 0) {
      router.replace(getDefaultRoute(flags, false));
    }
  }, [isAdmin, flags, tabDefs.length, router]);

  if (!isAdmin && flagsQuery.isLoading) {
    return <SkeletonCard className="h-64" />;
  }
  if (!isAdmin && flagsQuery.error) {
    return (
      <EmptyState
        title="Couldn't load your Dashboard Center access"
        description={(flagsQuery.error as Error).message}
      />
    );
  }

  if (tabDefs.length === 0) {
    // Covers the one real dead end left: nothing granted ANYWHERE, not
    // just no dashboard tabs — getDefaultRoute's own fallback already sent
    // them to /profile in that case, so this only flashes briefly while
    // that redirect is in flight.
    return <SkeletonCard className="h-64" />;
  }

  const requestedTab = searchParams.get("tab") ?? DEFAULT_TAB;
  const tab = tabDefs.some((t) => t.value === requestedTab) ? requestedTab : tabDefs[0].value;

  function selectTab(value: string) {
    router.push(`/dashboards?tab=${value}`);
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Dashboard Center</h1>
      </div>

      <div className="overflow-x-auto pb-1">
        {/* Left-aligned (Part: nav panel fix, 2026-10-19) — reverses the
            earlier "center" request once the user clarified in the same
            breath which tabs they meant: the Dashboard Center tab row
            itself stays left-aligned; it's the KPI label/value pairs
            *inside* each card ("inner data tabs" in their words) that are
            centered, via .kpi-cell's own text-align in this file's CSS. */}
        <Tabs value={tab} onValueChange={selectTab} tabs={tabDefs} />
      </div>

      {tab === "overview" && <OverviewTab />}
      {tab === "leads" && <LeadsTab />}
      {tab === "email" && <EmailTab />}
      {tab === "inbox" && <InboxTab />}
      {tab === "social" && <SocialTab />}
      {tab === "upwork" && <UpworkTab />}
      {tab === "meta-ads" && <MetaAdsTab />}
      {tab === "website-analytics" && <WebsiteAnalyticsTab />}
      {tab === "pipeline" && <PipelineTab />}
      {tab === "team" && <TeamTab />}
      {tab === "activity" && <ActivityTab />}
      {tab === "benchmarks" && <BenchmarksTab />}
    </div>
  );
}

export default function DashboardCenterPage() {
  return (
    <Suspense fallback={null}>
      <DashboardCenterTabs />
    </Suspense>
  );
}
