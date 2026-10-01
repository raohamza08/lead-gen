"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser } from "../../../lib/api-client";
import { Tabs } from "../../../components/ui/tabs";
import { EmptyState } from "../../../components/ui/empty-state";
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
  { value: "pipeline", label: "Pipeline" },
  { value: "team", label: "Team Performance" },
  { value: "activity", label: "Activity / Audit" },
  { value: "benchmarks", label: "Benchmarks" },
];

const DEFAULT_TAB = "overview";

// Mirrors DashboardCenterController's own @Roles matrix exactly (Part:
// Dashboard Center access fix, 2026-10-01, explicit user request — "the
// team is able to see the dashboards, but are not able to see the content
// in it... make sure that they don't see it"). Before this, every role saw
// the full tabbed shell and every API call underneath it 403'd, which read
// as a broken page rather than a hidden one. ADMIN/MANAGER see everything;
// BUSINESS_DEVELOPER only has backend access to the Upwork tab's routes
// (see dashboard-center.controller.ts's method-level @Roles overrides and
// UpworkRequestController's dashboardSummary route), so that's the only tab
// shown to them; every other role has zero Dashboard Center routes granted
// and gets a clean "no access" message instead of a page full of errors.
const FULL_ACCESS_ROLES = ["ADMIN", "MANAGER"];
const UPWORK_ONLY_ROLES = ["BUSINESS_DEVELOPER"];

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
  const role = getCurrentUser()?.role;
  const hasFullAccess = role ? FULL_ACCESS_ROLES.includes(role) : false;
  const isUpworkOnly = role ? UPWORK_ONLY_ROLES.includes(role) : false;

  if (!hasFullAccess && !isUpworkOnly) {
    return (
      <EmptyState
        title="No access to the Dashboard Center"
        description="This cross-team view is restricted to Admins, Managers, and (for the Upwork tab) Business Developers — ask an admin if you need access."
      />
    );
  }

  const tabDefs = hasFullAccess ? ALL_TAB_DEFS : ALL_TAB_DEFS.filter((t) => t.value === "upwork");
  const requestedTab = searchParams.get("tab") ?? DEFAULT_TAB;
  const tab = tabDefs.some((t) => t.value === requestedTab) ? requestedTab : tabDefs[0].value;

  function selectTab(value: string) {
    router.push(`/dashboards?tab=${value}`);
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Dashboard Center</h1>
        <p className="mt-0.5 text-xs text-ink/50">Cross-module BI — every dashboard in one place, switched with a tab instead of a page reload.</p>
      </div>

      <div className="overflow-x-auto pb-1">
        <Tabs value={tab} onValueChange={selectTab} tabs={tabDefs} />
      </div>

      {tab === "overview" && <OverviewTab />}
      {tab === "leads" && <LeadsTab />}
      {tab === "email" && <EmailTab />}
      {tab === "inbox" && <InboxTab />}
      {tab === "social" && <SocialTab />}
      {tab === "upwork" && <UpworkTab />}
      {tab === "meta-ads" && <MetaAdsTab />}
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
