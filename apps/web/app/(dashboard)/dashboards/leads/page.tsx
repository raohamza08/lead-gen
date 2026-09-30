"use client";

import { DashboardCenterShell, NotBuiltYet, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";

export default function LeadsDashboardPage() {
  const [dateRange, setDateRange] = useDashboardDateRange();
  return (
    <DashboardCenterShell
      title="Leads Dashboard"
      subtitle="Lead volume, source/niche breakdown, addition audit, and per-lead activity timeline."
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
    >
      <NotBuiltYet dataSources={["Lead", "NicheFilter", "LeadImport", "PipelineState", "User (uploadedByUserId)"]} />
    </DashboardCenterShell>
  );
}
