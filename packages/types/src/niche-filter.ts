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
