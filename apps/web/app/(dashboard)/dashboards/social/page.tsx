"use client";

import { DashboardCenterShell, NotBuiltYet, useDashboardDateRange } from "../../../../components/dashboard-center/dashboard-shell";

export default function SocialInboxDashboardPage() {
  const [dateRange, setDateRange] = useDashboardDateRange();
  return (
    <DashboardCenterShell
      title="Social Inbox Dashboard"
      subtitle="Conversation volume, platform breakdown, and per-user response metrics."
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
    >
      <NotBuiltYet dataSources={["SocialConversation", "SocialMessage", "SocialAccountAnalyticsSnapshot"]} />
      <p className="text-xs text-ink/45">
        Note: the schema has no link from a social conversation to a CRM Lead yet, so the
        &quot;message → lead → client&quot; conversion funnel in the spec can&apos;t be built honestly until that
        linkage exists — it will show as unavailable rather than a guessed number.
      </p>
    </DashboardCenterShell>
  );
}
