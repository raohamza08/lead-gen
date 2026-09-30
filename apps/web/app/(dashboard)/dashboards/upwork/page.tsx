"use client";

import { DashboardCenterShell, NotBuiltYet, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";

export default function UpworkDashboardPage() {
  const [dateRange, setDateRange] = useDashboardDateRange();
  return (
    <DashboardCenterShell
      title="Upwork + Connect Analytics Dashboard"
      subtitle="Bidding volume, invites, and connect economics."
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
    >
      <NotBuiltYet dataSources={["UpworkProposal"]} />
      <p className="text-xs text-ink/45">
        Note: bid/invite counts (bids per client, connects per client) are computable from
        UpworkProposal today. Every dollar metric (connect cost, cost per bid/client/invite) is
        not — there is no record anywhere of what a connect actually cost when purchased. That
        needs a real connect-purchase ledger (manually entered, since Upwork doesn&apos;t expose
        purchase price via API) before those numbers can be shown as real rather than guessed.
      </p>
    </DashboardCenterShell>
  );
}
