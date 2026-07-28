import { EmailPerformance } from "@leadgen/types";

/**
 * Pure rate arithmetic for the analytics reports, kept separate from
 * AnalyticsService so it can be tested without a database. Everything here is
 * a total function: no input combination throws, and none can produce NaN or
 * Infinity, because a dashboard that renders "NaN%" is worse than one that
 * renders nothing.
 */

/** Percentage to one decimal place; a zero denominator reads as 0, never NaN/Infinity. */
export function rate(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** The computed fields of EmailPerformance — everything derived rather than received. */
export type RateFields = {
  deliveryRate: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  meetingRate: number;
  conversionRate: number;
};

/** The raw counts buildPerformance consumes, before any rate is derived. */
export type PerformanceCounts = Omit<EmailPerformance, keyof RateFields | "notOpened"> & {
  meetings: number;
  won: number;
};

/**
 * Turns raw counts into the rate board.
 *
 * Engagement rates divide by delivered where delivery tracking exists and by
 * sent where it doesn't — SMTP sends produce no DELIVERED event, so dividing
 * by a delivered count of zero would report a 0% open rate on mail that was
 * demonstrably opened.
 */
export function buildPerformance(counts: PerformanceCounts): EmailPerformance {
  const { meetings, won, ...raw } = counts;
  const engagementBase = raw.delivered || raw.sent;

  return {
    ...raw,
    notOpened: Math.max(0, engagementBase - raw.opened),
    deliveryRate: rate(raw.delivered, raw.sent),
    openRate: rate(raw.opened, engagementBase),
    clickRate: rate(raw.clicked, engagementBase),
    replyRate: rate(raw.replied, engagementBase),
    meetingRate: rate(meetings, engagementBase),
    conversionRate: rate(won, engagementBase),
  };
}
