import { PerformanceCounts, buildPerformance, rate } from "./analytics.math";

/** A zeroed count set; each test overrides only the fields it cares about. */
const counts = (over: Partial<PerformanceCounts> = {}): PerformanceCounts => ({
  queued: 0,
  sent: 0,
  delivered: 0,
  opened: 0,
  clicked: 0,
  replied: 0,
  bounced: 0,
  spamComplaints: 0,
  unsubscribed: 0,
  blocked: 0,
  failed: 0,
  meetings: 0,
  won: 0,
  ...over,
});

describe("rate", () => {
  it("returns a percentage to one decimal place", () => {
    expect(rate(1, 3)).toBe(33.3);
    expect(rate(1, 2)).toBe(50);
    expect(rate(2, 2)).toBe(100);
  });

  it("reads a zero denominator as 0 rather than NaN", () => {
    // A brand-new org has sent nothing; every rate tile must still render.
    expect(rate(0, 0)).toBe(0);
    expect(Number.isNaN(rate(0, 0))).toBe(false);
  });

  it("never returns Infinity", () => {
    expect(Number.isFinite(rate(5, 0))).toBe(true);
  });
});

describe("buildPerformance", () => {
  it("divides engagement by delivered when delivery tracking exists", () => {
    const p = buildPerformance(counts({ sent: 100, delivered: 80, opened: 40, clicked: 8, replied: 4 }));

    expect(p.deliveryRate).toBe(80);
    expect(p.openRate).toBe(50); // 40/80, not 40/100
    expect(p.clickRate).toBe(10);
    expect(p.replyRate).toBe(5);
  });

  it("falls back to sent when the provider reports no deliveries", () => {
    // SMTP sends emit no DELIVERED event. Dividing by delivered=0 would report
    // a 0% open rate on mail that was demonstrably opened.
    const p = buildPerformance(counts({ sent: 50, delivered: 0, opened: 25 }));

    expect(p.openRate).toBe(50);
    expect(p.deliveryRate).toBe(0);
  });

  it("derives notOpened from the same base the open rate uses", () => {
    const p = buildPerformance(counts({ sent: 100, delivered: 80, opened: 30 }));
    expect(p.notOpened).toBe(50);
    expect(p.openRate).toBe(37.5);
  });

  it("never reports a negative notOpened", () => {
    // Defensive: a provider replaying delivery webhooks out of order can leave
    // opened above delivered momentarily.
    const p = buildPerformance(counts({ sent: 10, delivered: 5, opened: 8 }));
    expect(p.notOpened).toBe(0);
  });

  it("returns an all-zero board for an org with no email activity", () => {
    const p = buildPerformance(counts());

    for (const value of Object.values(p)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBe(0);
    }
  });

  it("scopes meeting and conversion rates to the engagement base", () => {
    const p = buildPerformance(counts({ sent: 100, delivered: 100, meetings: 12, won: 3 }));

    expect(p.meetingRate).toBe(12);
    expect(p.conversionRate).toBe(3);
  });

  it("passes raw counts through untouched", () => {
    const p = buildPerformance(counts({ queued: 7, bounced: 2, spamComplaints: 1, blocked: 3, failed: 4 }));

    expect(p.queued).toBe(7);
    expect(p.bounced).toBe(2);
    expect(p.spamComplaints).toBe(1);
    expect(p.blocked).toBe(3);
    expect(p.failed).toBe(4);
  });
});
