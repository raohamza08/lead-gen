import { resolveDateRange } from "./date-range";

// A fixed Wednesday, 2026-09-02 14:30 local — deterministic regardless of
// when the suite actually runs.
const NOW = new Date(2026, 8, 2, 14, 30, 0);

describe("resolveDateRange", () => {
  it("TODAY starts at midnight and ends at now", () => {
    const { from, to } = resolveDateRange("TODAY", NOW);
    expect(from.getHours()).toBe(0);
    expect(from.getDate()).toBe(2);
    expect(to).toEqual(NOW);
  });

  it("YESTERDAY covers exactly the prior calendar day", () => {
    const { from, to } = resolveDateRange("YESTERDAY", NOW);
    expect(from.getDate()).toBe(1);
    expect(to.getDate()).toBe(2);
    expect(to.getHours()).toBe(0);
  });

  it("THIS_WEEK starts on Monday", () => {
    const { from } = resolveDateRange("THIS_WEEK", NOW);
    expect(from.getDay()).toBe(1);
    expect(from.getDate()).toBe(31); // Monday 2026-08-31
  });

  it("LAST_WEEK is the 7 days immediately before THIS_WEEK's start", () => {
    const thisWeek = resolveDateRange("THIS_WEEK", NOW);
    const { from, to } = resolveDateRange("LAST_WEEK", NOW);
    expect(to).toEqual(thisWeek.from);
    expect(from.getDate()).toBe(24);
  });

  it("THIS_MONTH starts on the 1st", () => {
    const { from } = resolveDateRange("THIS_MONTH", NOW);
    expect(from.getDate()).toBe(1);
    expect(from.getMonth()).toBe(8);
  });

  it("LAST_MONTH is the full prior calendar month", () => {
    const { from, to } = resolveDateRange("LAST_MONTH", NOW);
    expect(from.getMonth()).toBe(7);
    expect(from.getDate()).toBe(1);
    expect(to.getMonth()).toBe(8);
    expect(to.getDate()).toBe(1);
  });

  it("LAST_30_DAYS and LAST_90_DAYS end at now", () => {
    expect(resolveDateRange("LAST_30_DAYS", NOW).to).toEqual(NOW);
    expect(resolveDateRange("LAST_90_DAYS", NOW).to).toEqual(NOW);
  });

  it("CUSTOM uses the given bounds", () => {
    const { from, to } = resolveDateRange("CUSTOM", NOW, "2026-01-01", "2026-02-01");
    expect(from.getUTCFullYear()).toBe(2026);
    expect(from.getUTCMonth()).toBe(0);
    expect(to.getUTCMonth()).toBe(1);
  });

  it("CUSTOM falls back to all-time on invalid/missing bounds rather than throwing", () => {
    const { from, to } = resolveDateRange("CUSTOM", NOW, "not-a-date", undefined);
    expect(from.getTime()).toBe(0);
    expect(to).toEqual(NOW);
  });

  it("ALL_TIME starts at the epoch", () => {
    const { from, to } = resolveDateRange("ALL_TIME", NOW);
    expect(from.getTime()).toBe(0);
    expect(to).toEqual(NOW);
  });
});
