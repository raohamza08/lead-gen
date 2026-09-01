/**
 * Rate arithmetic for the Lead Upload / Email Performance dashboard (Part:
 * Lead Upload Analytics / Email Performance / Ignore Groups, 2026-09-01) —
 * deliberately a sibling to analytics.math.ts, not a change to it.
 * analytics.math.ts's `rate`/`buildPerformance` compute open/reply rate from
 * TOTAL EVENTS and already back three shipped dashboards (email funnel,
 * LinkedIn funnel, revenue pipeline) — changing their meaning would silently
 * change those. This spec explicitly wants UNIQUE LEADS as the numerator
 * (distinguishing "450 open events" from "320 unique leads opened"), which
 * is a genuinely different metric, not a bug fix to the existing one.
 */

/** Percentage to one decimal place; a zero denominator reads as 0, never
 *  NaN/Infinity — same contract as analytics.math.ts's `rate`. */
export function uniqueRate(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export interface EmailPerformanceCounts {
  sent: number;
  delivered: number;
  uniqueLeadsOpened: number;
  uniqueLeadsReplied: number;
  failed: number;
  bounced: number;
}

export interface EmailPerformanceRates {
  openRate: number;
  replyRate: number;
  failureRate: number;
}

/**
 * Open/reply rate divide by delivered where delivery tracking exists and by
 * sent where it doesn't (SMTP sends produce no DELIVERED event) — same
 * fallback reasoning as analytics.math.ts's buildPerformance, applied to
 * unique-lead counts instead of total events. Failure rate divides by
 * attempted sends (sent + failed), not delivered — a failed send was never
 * delivered by definition.
 */
export function buildEmailPerformanceRates(counts: EmailPerformanceCounts): EmailPerformanceRates {
  const engagementBase = counts.delivered || counts.sent;
  const attempted = counts.sent + counts.failed;
  return {
    openRate: uniqueRate(counts.uniqueLeadsOpened, engagementBase),
    replyRate: uniqueRate(counts.uniqueLeadsReplied, engagementBase),
    failureRate: uniqueRate(counts.failed, attempted),
  };
}
