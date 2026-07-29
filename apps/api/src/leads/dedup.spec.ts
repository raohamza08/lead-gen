import { normaliseCompanyName, normaliseLinkedin } from "./leads.service";

/**
 * Tier-2 duplicate detection depends entirely on these two normalisers, and a
 * miss here means the same company gets contacted twice — the single most
 * visible quality failure in outbound.
 */
describe("normaliseCompanyName", () => {
  it("collapses legal suffixes and punctuation", () => {
    expect(normaliseCompanyName("Acme Ltd.")).toBe(normaliseCompanyName("acme limited"));
    expect(normaliseCompanyName("Beacon Inc")).toBe(normaliseCompanyName("Beacon, Incorporated"));
    expect(normaliseCompanyName("Northwind GmbH")).toBe(normaliseCompanyName("northwind gmbh"));
  });

  it("treats 'Co' and 'Company' as the same suffix", () => {
    // Without this, "Acme Co" and "Acme Company" normalise differently and the
    // same business gets contacted twice.
    expect(normaliseCompanyName("Acme Co")).toBe(normaliseCompanyName("Acme Company"));
  });

  it("keeps genuinely different companies apart", () => {
    expect(normaliseCompanyName("Acme Health")).not.toBe(normaliseCompanyName("Acme Legal"));
  });

  it("does not merge on 'Group' or 'Holdings'", () => {
    // These can be genuinely distinct entities. A false merge silently discards
    // a real lead, which is worse than a duplicate somebody can see and remove.
    expect(normaliseCompanyName("Harbor Recruiting")).not.toBe(
      normaliseCompanyName("Harbor Recruiting Group"),
    );
  });

  it("returns undefined for empty or suffix-only input", () => {
    expect(normaliseCompanyName("")).toBeUndefined();
    expect(normaliseCompanyName(undefined)).toBeUndefined();
    // A name that is nothing but a legal suffix normalises away to nothing, and
    // must not become an empty string that matches every other empty string.
    expect(normaliseCompanyName("Ltd.")).toBeUndefined();
  });
});

describe("normaliseLinkedin", () => {
  it("treats cosmetically different URLs for one company as equal", () => {
    const variants = [
      "https://www.linkedin.com/company/acme",
      "http://linkedin.com/company/acme/",
      "https://uk.linkedin.com/company/Acme",
      "linkedin.com/company/acme",
    ];
    const normalised = variants.map(normaliseLinkedin);
    expect(new Set(normalised).size).toBe(1);
    expect(normalised[0]).toBe("company/acme");
  });

  it("keeps different companies apart", () => {
    expect(normaliseLinkedin("https://linkedin.com/company/acme")).not.toBe(
      normaliseLinkedin("https://linkedin.com/company/acme-health"),
    );
  });

  it("returns undefined for missing input", () => {
    expect(normaliseLinkedin(undefined)).toBeUndefined();
    expect(normaliseLinkedin("")).toBeUndefined();
  });
});
