/**
 * Pure date-range resolution for the Lead Upload / Email Performance
 * dashboard (Part: Lead Upload Analytics / Email Performance / Ignore
 * Groups, 2026-09-01) — kept dependency-free and separate from
 * AnalyticsService the same way analytics.math.ts is, so it's testable
 * without a database and without a request context.
 *
 * Boundaries are computed in server time (matches AnalyticsService.
 * computeSummary's existing `setHours(0,0,0,0)` convention elsewhere in this
 * file) — the one place in this app that's genuinely per-org timezone-aware
 * is the Sending Schedule feature, where the schedule itself carries an
 * explicit timezone; a reporting dashboard's "Today" doesn't warrant the
 * same complexity.
 */
export type DateRangeName =
  | "TODAY"
  | "YESTERDAY"
  | "THIS_WEEK"
  | "LAST_WEEK"
  | "THIS_MONTH"
  | "LAST_MONTH"
  | "LAST_30_DAYS"
  | "LAST_90_DAYS"
  | "CUSTOM"
  | "ALL_TIME";

export interface ResolvedDateRange {
  from: Date;
  to: Date;
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** Monday as the week start — the common business-week convention, and the
 *  one every other "week" concept in a sales-facing dashboard assumes. */
function startOfWeek(d: Date): Date {
  const copy = startOfDay(d);
  const day = copy.getDay(); // 0 = Sunday
  const diff = (day + 6) % 7; // days since Monday
  copy.setDate(copy.getDate() - diff);
  return copy;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** `now` is a parameter (not `new Date()` internally) purely so the pure
 *  function stays trivially testable — every real caller passes `new Date()`. */
export function resolveDateRange(
  range: DateRangeName,
  now: Date,
  customFrom?: string,
  customTo?: string,
): ResolvedDateRange {
  const today = startOfDay(now);

  switch (range) {
    case "TODAY":
      return { from: today, to: now };
    case "YESTERDAY":
      return { from: addDays(today, -1), to: today };
    case "THIS_WEEK":
      return { from: startOfWeek(now), to: now };
    case "LAST_WEEK": {
      const thisWeek = startOfWeek(now);
      return { from: addDays(thisWeek, -7), to: thisWeek };
    }
    case "THIS_MONTH":
      return { from: startOfMonth(now), to: now };
    case "LAST_MONTH": {
      const thisMonth = startOfMonth(now);
      return { from: new Date(thisMonth.getFullYear(), thisMonth.getMonth() - 1, 1), to: thisMonth };
    }
    case "LAST_30_DAYS":
      return { from: addDays(today, -30), to: now };
    case "LAST_90_DAYS":
      return { from: addDays(today, -90), to: now };
    case "CUSTOM": {
      // An invalid/missing custom bound falls back to "all time" rather than
      // throwing — a dashboard rendering nothing is worse than one rendering
      // more than a malformed request intended.
      const from = customFrom ? new Date(customFrom) : new Date(0);
      const to = customTo ? new Date(customTo) : now;
      return {
        from: Number.isNaN(from.getTime()) ? new Date(0) : from,
        to: Number.isNaN(to.getTime()) ? now : to,
      };
    }
    case "ALL_TIME":
    default:
      return { from: new Date(0), to: now };
  }
}
