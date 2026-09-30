"use client";

import { DashboardCenterShell, NotBuiltYet, useDashboardDateRange } from "../../../components/dashboard-center/dashboard-shell";

export default function ExecutiveDashboardPage() {
  const [dateRange, setDateRange] = useDashboardDateRange();
  return (
    <DashboardCenterShell
      title="Overview / Executive Dashboard"
      subtitle="Management-level KPIs and channel performance across every module."
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
    >
      <NotBuiltYet
        dataSources={[
          "Lead", "EmailMessage/EmailEvent", "SocialConversation", "UpworkProposal",
          "MetaAdInsightDaily", "PipelineStage transitions", "User",
        ]}
      />
    </DashboardCenterShell>
  );
}
