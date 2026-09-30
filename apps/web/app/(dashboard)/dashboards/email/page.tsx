"use client";

import { DashboardCenterShell, NotBuiltYet, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";

export default function EmailCampaignDashboardPage() {
  const [dateRange, setDateRange] = useDashboardDateRange();
  return (
    <DashboardCenterShell
      title="Email Campaign Dashboard"
      subtitle="Sequence-stage funnel, queue analytics, response timing, and campaign comparison."
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
    >
      <NotBuiltYet dataSources={["EmailMessage", "EmailEvent", "SendingSession", "Campaign"]} />
    </DashboardCenterShell>
  );
}
