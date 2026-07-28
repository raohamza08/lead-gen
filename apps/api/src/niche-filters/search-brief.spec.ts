import { buildSearchBrief } from "./search-brief";

const base = { niche: "SaaS" };

describe("buildSearchBrief", () => {
  it("always states the niche, since it is the only required criterion", () => {
    expect(buildSearchBrief(base)).toContain("Industry / niche: SaaS");
  });

  it("expands taxonomy values into their explanations, not raw enum tokens", () => {
    const brief = buildSearchBrief({ ...base, aiOpportunitySignals: ["MANUAL_WORKFLOWS"] });

    // The whole point of the brief: the model must never see a bare
    // MANUAL_WORKFLOWS token with no indication of what to look for.
    expect(brief).toContain("Manual / spreadsheet-run workflows");
    expect(brief).toContain("The core qualifying signal");
    expect(brief).not.toMatch(/^- MANUAL_WORKFLOWS$/m);
  });

  it("omits sections with no values rather than emitting empty headings", () => {
    const brief = buildSearchBrief(base);
    expect(brief).not.toContain("GROWTH STAGE");
    expect(brief).not.toContain("EXCLUDE");
    expect(brief).not.toContain("DECISION MAKER");
  });

  it("states exclusions as hard rejects", () => {
    const brief = buildSearchBrief({ ...base, exclusionSignals: ["COMPETING_AGENCIES"] });
    expect(brief).toContain("EXCLUDE");
    expect(brief).toContain("however well it scores above");
    expect(brief).toContain("Competing AI / automation agencies");
  });

  it("keeps unrecognised values instead of silently dropping them", () => {
    // A catalogue entry renamed after a filter was saved must not narrow the
    // search invisibly.
    const brief = buildSearchBrief({ ...base, growthStages: ["SERIES_A", "RETIRED_OPTION"] });
    expect(brief).toContain("Series A");
    expect(brief).toContain("RETIRED_OPTION");
  });

  it("renders open-ended and closed numeric ranges correctly", () => {
    expect(buildSearchBrief({ ...base, employeeCountMin: 11, employeeCountMax: 200 }))
      .toContain("11-200 employees");
    expect(buildSearchBrief({ ...base, employeeCountMin: 50 })).toContain("50+ employees");
    expect(buildSearchBrief({ ...base, employeeCountMax: 500 })).toContain("up to 500 employees");
  });

  it("treats a zero lower bound as a real value, not as absent", () => {
    // Founded this year is a legitimate filter; `0` must not be swallowed by a
    // falsy check.
    expect(buildSearchBrief({ ...base, yearsInBusinessMin: 0, yearsInBusinessMax: 3 }))
      .toContain("0-3 years");
  });

  it("tells the model to weight intent signals above firmographics", () => {
    const brief = buildSearchBrief({ ...base, hiringSignals: ["HIRING_OPS_ROLES"] });
    expect(brief).toContain("BUYING-INTENT SIGNALS");
    expect(brief).toContain("weight these most heavily");
  });

  it("combines countries and cities into one location line", () => {
    const brief = buildSearchBrief({ ...base, countries: ["United States"], cities: ["Austin"] });
    expect(brief).toContain("Location: United States, Austin");
  });

  it("produces a brief with no criteria beyond the niche when nothing else is set", () => {
    const brief = buildSearchBrief(base);
    expect(brief.split("\n\n")).toHaveLength(1);
  });
});
