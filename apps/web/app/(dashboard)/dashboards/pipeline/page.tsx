"use client";

import { DashboardCenterShell, NotBuiltYet, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";

export default function PipelineDashboardPage() {
  const [dateRange, setDateRange] = useDashboardDateRange();
  return (
    <DashboardCenterShell
      title="Pipeline / Conversion Dashboard"
      subtitle="Stage-by-stage funnel, conversion rates, and lead aging."
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
    >
      <NotBuiltYet dataSources={["Lead (stage)", "PipelineState"]} />
      <p className="text-xs text-ink/45">
        Note: only the current stage and one prior stage are stored today, not a full history of
        every stage a lead passed through. &quot;Average time in stage&quot; and stage-to-stage
        conversion over a historical window need a new stage-history log before they can be shown
        as real rather than computed from current state alone.
      </p>
    </DashboardCenterShell>
  );
}
