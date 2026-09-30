"use client";

import { DashboardCenterShell, NotBuiltYet, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";

export default function ActivityAuditDashboardPage() {
  const [dateRange, setDateRange] = useDashboardDateRange();
  return (
    <DashboardCenterShell
      title="Activity / Audit Dashboard"
      subtitle="Searchable log of who did what, when, across every module."
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
    >
      <NotBuiltYet dataSources={["AuditLog", "SocialAuditLog"]} />
      <p className="text-xs text-ink/45">
        Note: AuditLog today only gets written on login/logout, team-management changes, and
        routes with an :id in the URL — most creation actions (adding leads, importing a CSV,
        creating a campaign, connecting an Upwork/Meta account) aren&apos;t logged yet. This
        dashboard needs those write points added first, not just a UI over existing rows, or it
        would misrepresent activity as far lower than it actually is.
      </p>
    </DashboardCenterShell>
  );
}
