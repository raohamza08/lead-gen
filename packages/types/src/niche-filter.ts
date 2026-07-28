/** Matches NICHE_FILTER (Part B4) + Lead Extraction Settings screen (Part F4). */
export interface NicheFilter {
  id: string;
  orgId: string;
  niche: string;
  subNiche: string | null;
  countries: string[];
  cities: string[];
  companySizeMin: number | null;
  companySizeMax: number | null;
  revenueBandMin: string | null;
  revenueBandMax: string | null;
  employeeCountMin: number | null;
  employeeCountMax: number | null;
  jobTitles: string[];
  technologies: string[];
  fundingStage: string | null;
  businessModel: string | null;
  b2bOrB2c: string | null;

  // --- Targeting filters (values come from filter-taxonomy.ts) ---
  // Empty array everywhere means "no constraint on this dimension", never
  // "match nothing" — otherwise every existing filter would stop returning
  // leads the moment these columns were added.
  companyTypes: string[];
  growthStages: string[];
  companyKeywords: string[];
  departments: string[];
  seniorityLevels: string[];
  yearsInBusinessMin: number | null;
  yearsInBusinessMax: number | null;
  hiringSignals: string[];
  websiteConditions: string[];
  aiOpportunitySignals: string[];

  // --- Exclusions. Applied after every inclusion filter; anything matching
  // here is rejected regardless of how well it scores elsewhere. ---
  exclusionSignals: string[];
  excludeIndustries: string[];
  excludeKeywords: string[];
  excludeCompanies: string[];

  dailyTarget: number;
  sourcePriority: string[];
  scheduleCron: string;
  timezone: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExtractionRun {
  id: string;
  filterId: string;
  startedAt: string;
  finishedAt: string | null;
  leadsFound: number;
  leadsVerified: number;
  duplicatesSkipped: number;
  status: "RUNNING" | "COMPLETED" | "COMPLETED_SHORT_OF_TARGET" | "FAILED";
}
