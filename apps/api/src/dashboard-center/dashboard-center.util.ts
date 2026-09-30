import { DateRangeName, resolveDateRange, ResolvedDateRange } from "../analytics/date-range";

export type CompareMode = "last_month" | "previous_period";

export interface DashboardRangeQuery {
  range?: DateRangeName;
  from?: string;
  to?: string;
  compare?: string;
  compareMode?: string;
}

export interface ResolvedDashboardRange {
  current: ResolvedDateRange;
  previous: ResolvedDateRange | null;
  compareMode: CompareMode | null;
}

/** The full previous calendar month, e.g. resolved on any day in October
 *  returns September 1st 00:00 through September 30th 23:59:59.999 --
 *  independent of whatever date range is currently selected above it (Part:
 *  Dashboard Center, 2026-09-30 — "auto set to last month" is the default
 *  comparison target unless the user explicitly picks 'previous period'
 *  instead). */
function lastCalendarMonthRange(now: Date): ResolvedDateRange {
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
  const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  return { from, to };
}

/** Every Dashboard Center endpoint takes the same {range, from, to, compare,
 *  compareMode} shape and resolves it the same way -- one place, so "This
 *  month vs last month" always means the same thing everywhere in the
 *  Dashboard Center. Comparison is ON by default (Part: Dashboard Center,
 *  2026-09-30 fix — previously required an explicit opt-in checkbox that
 *  looked broken since nothing changed until it was found and toggled);
 *  pass `compare=false` to explicitly turn it off. `compareMode` defaults
 *  to `last_month`; pass `previous_period` for the equal-length preceding
 *  window instead (e.g. the 30 days before a selected 30-day range). */
export function resolveDashboardRange(query: DashboardRangeQuery): ResolvedDashboardRange {
  const now = new Date();
  const current = resolveDateRange(query.range ?? "LAST_30_DAYS", now, query.from, query.to);
  if (query.compare === "false") return { current, previous: null, compareMode: null };

  const compareMode: CompareMode = query.compareMode === "previous_period" ? "previous_period" : "last_month";
  if (compareMode === "last_month") {
    return { current, previous: lastCalendarMonthRange(now), compareMode };
  }

  const spanMs = current.to.getTime() - current.from.getTime();
  return {
    current,
    previous: { from: new Date(current.from.getTime() - spanMs), to: current.from },
    compareMode,
  };
}

/** Neutral current-vs-previous delta -- never labeled good/bad (Part:
 *  Dashboard Center spec section 14 — "do not automatically describe this
 *  as good or bad"). `null` means there's nothing to compare against (no
 *  previous-period value, or it was zero — 0 -> N has no meaningful %). */
export function percentDelta(current: number, previous: number | undefined): number | null {
  if (previous === undefined || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/** Safe division for every ratio in the Dashboard Center (Part: spec section
 *  27 — "all formulas must handle null/zero denominators safely"). Returns
 *  undefined (render as "—" / "Data unavailable"), never 0 or Infinity, when
 *  the denominator is 0 -- a 0% rate and "cannot be computed" are different
 *  claims and must never be conflated. */
export function safeRate(numerator: number, denominator: number, multiplier = 100): number | undefined {
  if (!denominator) return undefined;
  return (numerator / denominator) * multiplier;
}

export function safeDivide(numerator: number, denominator: number): number | undefined {
  if (!denominator) return undefined;
  return numerator / denominator;
}
