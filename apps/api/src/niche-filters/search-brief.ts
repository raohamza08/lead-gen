import { FILTER_TAXONOMY, FilterTaxonomyKey } from "@leadgen/types";

/**
 * Renders a NicheFilter into a human-readable brief for the lead-finder.
 *
 * The worker previously received the raw database row and JSON-dumped it into
 * the prompt, so the model saw tokens like `MANUAL_WORKFLOWS` and
 * `HIRING_OPS_ROLES` with no indication of what they meant or how to verify
 * them. It could only pattern-match on the label, which made most of the
 * filters decorative.
 *
 * Expanding each value to its catalogue explanation happens here, in the API,
 * because the taxonomy is TypeScript and lives in packages/types. Duplicating
 * it in Python would guarantee the two drift.
 *
 * Empty sections are omitted entirely rather than rendered as "none" — a
 * prompt full of empty headings dilutes the criteria that do matter.
 */

interface FilterLike {
  niche: string;
  subNiche?: string | null;
  countries?: string[];
  cities?: string[];
  employeeCountMin?: number | null;
  employeeCountMax?: number | null;
  revenueBandMin?: string | null;
  revenueBandMax?: string | null;
  yearsInBusinessMin?: number | null;
  yearsInBusinessMax?: number | null;
  jobTitles?: string[];
  technologies?: string[];
  fundingStage?: string | null;
  businessModel?: string | null;
  b2bOrB2c?: string | null;
  companyTypes?: string[];
  growthStages?: string[];
  companyKeywords?: string[];
  departments?: string[];
  seniorityLevels?: string[];
  hiringSignals?: string[];
  websiteConditions?: string[];
  aiOpportunitySignals?: string[];
  exclusionSignals?: string[];
  excludeIndustries?: string[];
  excludeKeywords?: string[];
  excludeCompanies?: string[];
}

/** Expands stored values into "Label — why it matters" lines. */
function explain(key: FilterTaxonomyKey, values?: string[]): string[] {
  if (!values?.length) return [];
  return values.flatMap((value) => {
    const option = FILTER_TAXONOMY[key].find((o) => o.value === value);
    // An unrecognised value still gets through: a catalogue entry may have been
    // renamed after the filter was saved, and dropping it silently would narrow
    // the search with no trace.
    return option ? [`- ${option.label} — ${option.why}`] : [`- ${value}`];
  });
}

function range(min?: number | null, max?: number | null, unit = ""): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) return `${min}-${max}${unit}`;
  if (min != null) return `${min}+${unit}`;
  return `up to ${max}${unit}`;
}

export function buildSearchBrief(filter: FilterLike): string {
  const sections: string[] = [];
  const push = (heading: string, lines: string[]) => {
    if (lines.length) sections.push(`${heading}\n${lines.join("\n")}`);
  };

  // --- Firmographics: who the company is ---
  const profile: string[] = [];
  profile.push(`- Industry / niche: ${filter.niche}${filter.subNiche ? ` — ${filter.subNiche}` : ""}`);

  const locations = [...(filter.countries ?? []), ...(filter.cities ?? [])];
  if (locations.length) profile.push(`- Location: ${locations.join(", ")}`);

  const headcount = range(filter.employeeCountMin, filter.employeeCountMax, " employees");
  if (headcount) profile.push(`- Company headcount: ${headcount}`);

  if (filter.revenueBandMin || filter.revenueBandMax) {
    profile.push(`- Revenue range: ${[filter.revenueBandMin, filter.revenueBandMax].filter(Boolean).join(" to ")}`);
  }

  const age = range(filter.yearsInBusinessMin, filter.yearsInBusinessMax, " years");
  if (age) profile.push(`- Years in business: ${age}`);

  if (filter.businessModel) profile.push(`- Business model: ${filter.businessModel}`);
  if (filter.b2bOrB2c) profile.push(`- Sells to: ${filter.b2bOrB2c}`);
  if (filter.fundingStage) profile.push(`- Funding status: ${filter.fundingStage}`);
  if (filter.technologies?.length) profile.push(`- Technologies in use: ${filter.technologies.join(", ")}`);
  if (filter.companyKeywords?.length) {
    profile.push(`- Company keywords (site, description or positioning should relate to): ${filter.companyKeywords.join(", ")}`);
  }
  push("TARGET COMPANY PROFILE", profile);

  push("COMPANY TYPE — prefer these ownership structures", explain("companyTypes", filter.companyTypes));
  push("GROWTH STAGE — prefer companies at these stages", explain("growthStages", filter.growthStages));

  // --- Who to find inside the company ---
  const contact: string[] = [];
  if (filter.jobTitles?.length) contact.push(`- Preferred job titles: ${filter.jobTitles.join(", ")}`);
  contact.push(...explain("departments", filter.departments));
  contact.push(...explain("seniorityLevels", filter.seniorityLevels));
  push("DECISION MAKER — find a contact matching this", contact);

  // --- Intent signals: whether they will actually buy ---
  push(
    "BUYING-INTENT SIGNALS — weight these most heavily. Firmographics say who a company is; these say whether it will buy. A company matching several is a strong lead even if the firmographics are an imperfect fit.",
    [
      ...explain("aiOpportunitySignals", filter.aiOpportunitySignals),
      ...explain("hiringSignals", filter.hiringSignals),
    ],
  );

  push(
    "WEBSITE / TECHNOLOGY CONDITIONS — verify these by actually fetching the company's site, and record what you observed",
    explain("websiteConditions", filter.websiteConditions),
  );

  // --- Exclusions last, and stated as hard rejects ---
  const exclusions = [...explain("exclusionSignals", filter.exclusionSignals)];
  if (filter.excludeIndustries?.length) exclusions.push(`- Industries to exclude: ${filter.excludeIndustries.join(", ")}`);
  if (filter.excludeKeywords?.length) exclusions.push(`- Keywords to exclude: ${filter.excludeKeywords.join(", ")}`);
  if (filter.excludeCompanies?.length) exclusions.push(`- Companies to exclude by name: ${filter.excludeCompanies.join(", ")}`);
  push("EXCLUDE — reject any company matching these, however well it scores above", exclusions);

  return sections.join("\n\n");
}
