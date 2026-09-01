import { EmailPerformanceCounts, buildEmailPerformanceRates, uniqueRate } from "./unique-rate";

const counts = (over: Partial<EmailPerformanceCounts> = {}): EmailPerformanceCounts => ({
  sent: 0,
  delivered: 0,
  uniqueLeadsOpened: 0,
  uniqueLeadsReplied: 0,
  failed: 0,
  bounced: 0,
  ...over,
});

describe("uniqueRate", () => {
  it("returns a percentage to one decimal place", () => {
    expect(uniqueRate(120, 1000)).toBe(12);
    expect(uniqueRate(1, 3)).toBe(33.3);
  });

  it("reads a zero denominator as 0, never NaN/Infinity", () => {
    expect(uniqueRate(0, 0)).toBe(0);
    expect(Number.isFinite(uniqueRate(5, 0))).toBe(true);
  });
});

describe("buildEmailPerformanceRates", () => {
  it("matches the spec's worked example: 1000 delivered, 120 unique repliers -> 12%", () => {
    const rates = buildEmailPerformanceRates(counts({ sent: 1000, delivered: 1000, uniqueLeadsReplied: 120 }));
    expect(rates.replyRate).toBe(12);
  });

  it("falls back to sent as the engagement base when nothing was DELIVERED-tracked (SMTP)", () => {
    const rates = buildEmailPerformanceRates(counts({ sent: 100, delivered: 0, uniqueLeadsOpened: 25 }));
    expect(rates.openRate).toBe(25);
  });

  it("failure rate divides by attempted (sent + failed), not delivered", () => {
    const rates = buildEmailPerformanceRates(counts({ sent: 90, failed: 10, delivered: 90 }));
    expect(rates.failureRate).toBe(10);
  });

  it("never inflates a rate from multiple events by the same lead — caller supplies unique counts", () => {
    // buildEmailPerformanceRates trusts its input is already unique-lead
    // counted; this test documents that contract rather than testing
    // dedup logic that lives in the SQL query, not here.
    const rates = buildEmailPerformanceRates(counts({ sent: 10, delivered: 10, uniqueLeadsOpened: 3 }));
    expect(rates.openRate).toBe(30);
  });
});
