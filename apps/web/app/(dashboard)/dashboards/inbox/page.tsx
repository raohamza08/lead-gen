"use client";

import { DashboardCenterShell, NotBuiltYet, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";

export default function UnifiedInboxDashboardPage() {
  const [dateRange, setDateRange] = useDashboardDateRange();
  return (
    <DashboardCenterShell
      title="Unified Inbox Dashboard"
      subtitle="Connected mailbox volume and new-lead detection from inbound email."
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
    >
      <NotBuiltYet dataSources={["EmailAccount", "InboundEmailThread", "InboundEmailMessage"]} />
    </DashboardCenterShell>
  );
}
