"use client";

import { DashboardCenterShell, NotBuiltYet, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";

export default function TeamPerformanceDashboardPage() {
  const [dateRange, setDateRange] = useDashboardDateRange();
  return (
    <DashboardCenterShell
      title="Team Performance Dashboard"
      subtitle="Per-user activity across leads, social, and Upwork."
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
    >
      <NotBuiltYet dataSources={["User", "Lead (uploadedByUserId)", "SocialConversation (assignedToUserId)", "UpworkProposal"]} />
      <p className="text-xs text-ink/45">
        Note: Upwork attributes a submitter by a free-text name, not a real user account, so
        per-person Upwork rollups may not line up exactly with a login. Email sending has no
        per-user attribution field at all today — only which lead an email belongs to, not which
        person is credited for it.
      </p>
    </DashboardCenterShell>
  );
}
