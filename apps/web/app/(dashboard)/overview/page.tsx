"use client";

import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { api } from "../../../lib/api-client";
import { KpiTile } from "../../../components/kpi-tile";
import { AXIS_PROPS, GRID_PROPS, SINGLE_SERIES, TOOLTIP_STYLE } from "../../../components/chart-kit";
import type { AnalyticsSummary, FunnelStageCount } from "@leadgen/types";

export default function OverviewPage() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [funnel, setFunnel] = useState<FunnelStageCount[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getSummary(), api.getFunnel()])
      .then(([s, f]) => {
        setSummary(s as AnalyticsSummary);
        setFunnel(f as FunnelStageCount[]);
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  if (error) return <p className="text-bad">{error}</p>;
  if (!summary) return <p className="text-ink/60">Loading…</p>;

  return (
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
        <KpiTile label="Today's Leads" value={summary.todaysLeads} />
        <KpiTile label="Verified" value={summary.verifiedLeads} />
        <KpiTile label="Dup Rate" value={`${summary.duplicateRate}%`} />
        <KpiTile label="Avg Lead Score" value={summary.avgLeadScore} />
        <KpiTile label="Pending Review" value={summary.pendingReviews} tone={summary.pendingReviews > 0 ? "gold" : undefined} />
        <KpiTile label="Meetings Booked" value={summary.meetingsBooked} tone="good" />
        <KpiTile label="Won" value={summary.wonDeals} tone="good" />
        <KpiTile label="System Errors" value={summary.systemErrors} tone={summary.systemErrors > 0 ? "bad" : "good"} />
      </section>

      <section className="rounded-lg border border-[var(--line)] p-4">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-ink/60">Pipeline Funnel</h2>
        <div className="h-72 w-full overflow-x-auto">
          <ResponsiveContainer width="100%" height="100%" minWidth={640}>
            <BarChart data={funnel} margin={{ top: 8, right: 8, left: 8, bottom: 40 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="stage" angle={-35} textAnchor="end" interval={0} height={70} {...AXIS_PROPS} />
              <YAxis allowDecimals={false} {...AXIS_PROPS} />
              <Tooltip {...TOOLTIP_STYLE} />
              {/* One series, one colour — a per-bar ramp would double-encode the height. */}
              <Bar dataKey="count" fill={SINGLE_SERIES} radius={[4, 4, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
