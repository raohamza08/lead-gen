import { DateRangeName, resolveDateRange, ResolvedDateRange } from "../analytics/date-range";

export interface DashboardRangeQuery {
  range?: DateRangeName;
  from?: string;
  to?: string;
  compare?: string;
}

export interface ResolvedDashboardRange {
  current: ResolvedDateRange;
  previous: ResolvedDateRange | null;
}

/** Every Dashboard Center endpoint takes the same {range, from, to, compare}
 *  shape and resolves it the same way -- one place, so "This month vs last
 *  month" always means the same thing everywhere in the Dashboard Center. */
export function resolveDashboardRange(query: DashboardRangeQuery): ResolvedDashboardRange {
  const now = new Date();
  const current = resolveDateRange(query.range ?? "LAST_30_DAYS", now, query.from, query.to);
  if (query.compare !== "true") return { current, previous: null };

  const spanMs = current.to.getTime() - current.from.getTime();
  return {
    current,
    previous: { from: new Date(current.from.getTime() - spanMs), to: current.from },
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
