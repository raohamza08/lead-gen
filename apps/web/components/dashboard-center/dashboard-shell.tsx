"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { DashboardDateRangeBar, DashboardDateRange, defaultDashboardDateRange } from "./date-range-bar";
import { Spinner } from "../spinner";

/**
 * Shared chrome for every Dashboard Center page (Part: Dashboard Center
 * spec section 1) — title, the universal date-range filter, a refresh
 * button, and a "last updated" timestamp. Each dashboard passes its own
 * `children` for the actual KPIs/charts/tables; this file only owns the
 * chrome so it can't drift page to page.
 *
 * `onRefresh` is optional — a dashboard that hasn't been wired to a real
 * query yet (see NotBuiltYet below) has nothing to refresh. `refreshing`
 * drives the button's own spinner/disabled state and auto-stamps "Last
 * updated" the moment a refresh completes (Part: Dashboard Center,
 * 2026-09-30 fix — previously the button gave zero visual feedback on
 * click, which read as "doesn't work" even though the underlying refetch
 * genuinely ran; no page needs to track its own timestamp for this).
 */
export function DashboardCenterShell({
  title,
  subtitle,
  dateRange,
  onDateRangeChange,
  onRefresh,
  refreshing,
  extraFilters,
  children,
}: {
  title: string;
  subtitle?: string;
  dateRange: DashboardDateRange;
  onDateRangeChange: (range: DashboardDateRange) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  extraFilters?: ReactNode;
  children: ReactNode;
}) {
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const wasRefreshing = useRef(refreshing);
  useEffect(() => {
    if (wasRefreshing.current && !refreshing) setLastUpdated(new Date());
    wasRefreshing.current = refreshing;
  }, [refreshing]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs text-ink/50">{subtitle}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <DashboardDateRangeBar value={dateRange} onChange={onDateRangeChange} />
        <div className="flex items-center gap-3">
          {extraFilters}
          {lastUpdated && <span className="text-xs text-ink/45">Last updated {lastUpdated.toLocaleTimeString()}</span>}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="flex items-center gap-1.5 rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-60"
            >
              {refreshing && <Spinner className="h-3 w-3" />}
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          )}
        </div>
      </div>

      {children}
    </div>
  );
}

/** Honest placeholder for a dashboard whose backend isn't built yet (Part:
 *  Dashboard Center spec section 30 — "do not invent data"). Distinct from
 *  EmptyState/ErrorState: this isn't claiming "0 records" or "data
 *  unavailable" about real data, it's stating the feature itself doesn't
 *  exist yet, with the concrete data sources the real version will read
 *  from so the gap is visible rather than silently faked. */
export function NotBuiltYet({ dataSources }: { dataSources: string[] }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-4 py-12 text-center">
      <p className="text-sm font-medium text-ink/70">This dashboard hasn&apos;t been built yet</p>
      <p className="max-w-md text-xs text-ink/45">
        No numbers are shown here rather than fabricated ones. When built, this page will compute its metrics from:
      </p>
      <ul className="flex max-w-md flex-wrap justify-center gap-1.5">
        {dataSources.map((s) => (
          <li key={s} className="rounded-full bg-ink/5 px-2 py-1 text-[11px] text-ink/60">
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Convenience hook so each placeholder page doesn't repeat the same
 *  useState boilerplate — once a dashboard gets a real backend endpoint,
 *  its page swaps this for a real useQuery keyed on `dateRange`. */
export function useDashboardDateRange() {
  return useState<DashboardDateRange>(defaultDashboardDateRange());
}
