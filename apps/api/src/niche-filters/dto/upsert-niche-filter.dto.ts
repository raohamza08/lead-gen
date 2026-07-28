import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { allowedValues } from "@leadgen/types";

/**
 * Values for the taxonomy-backed fields are checked against the shared
 * catalogue rather than accepted as free text. A typo'd value would otherwise
 * store cleanly, render as an unknown chip in the UI, and quietly narrow the
 * search to nothing — a failure with no error message anywhere.
 *
 * `each: true` applies the check per array element.
 */
const inTaxonomy = (key: Parameters<typeof allowedValues>[0]) =>
  IsIn(allowedValues(key), { each: true });

export class UpsertNicheFilterDto {
  @IsString()
  niche!: string;

  @IsOptional()
  @IsString()
  subNiche?: string;

  @IsOptional()
  @IsArray()
  countries?: string[];

  @IsOptional()
  @IsArray()
  cities?: string[];

  @IsOptional()
  @IsInt()
  companySizeMin?: number;

  @IsOptional()
  @IsInt()
  companySizeMax?: number;

  @IsOptional()
  @IsString()
  revenueBandMin?: string;

  @IsOptional()
  @IsString()
  revenueBandMax?: string;

  @IsOptional()
  @IsInt()
  employeeCountMin?: number;

  @IsOptional()
  @IsInt()
  employeeCountMax?: number;

  @IsOptional()
  @IsArray()
  jobTitles?: string[];

  @IsOptional()
  @IsArray()
  technologies?: string[];

  @IsOptional()
  @IsString()
  fundingStage?: string;

  @IsOptional()
  @IsString()
  businessModel?: string;

  @IsOptional()
  @IsString()
  b2bOrB2c?: string;

  // --- Targeting filters. Empty/omitted means "no constraint on this
  // dimension", so leaving them all blank reproduces the previous behaviour. ---

  @IsOptional()
  @IsArray()
  @inTaxonomy("companyTypes")
  companyTypes?: string[];

  @IsOptional()
  @IsArray()
  @inTaxonomy("growthStages")
  growthStages?: string[];

  // Free text by design: keywords are whatever the operator's vertical calls
  // things, and no fixed catalogue could cover every niche the product targets.
  // Capped so a paste accident can't blow up the search prompt.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  companyKeywords?: string[];

  @IsOptional()
  @IsArray()
  @inTaxonomy("departments")
  departments?: string[];

  @IsOptional()
  @IsArray()
  @inTaxonomy("seniorityLevels")
  seniorityLevels?: string[];

  // 0 is meaningful (founded this year); 200 is a sanity ceiling.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200)
  yearsInBusinessMin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200)
  yearsInBusinessMax?: number;

  @IsOptional()
  @IsArray()
  @inTaxonomy("hiringSignals")
  hiringSignals?: string[];

  @IsOptional()
  @IsArray()
  @inTaxonomy("websiteConditions")
  websiteConditions?: string[];

  @IsOptional()
  @IsArray()
  @inTaxonomy("aiOpportunitySignals")
  aiOpportunitySignals?: string[];

  // --- Exclusions ---

  @IsOptional()
  @IsArray()
  @inTaxonomy("exclusionSignals")
  exclusionSignals?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  excludeIndustries?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  excludeKeywords?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(200)
  excludeCompanies?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  dailyTarget?: number;

  @IsOptional()
  @IsArray()
  sourcePriority?: string[];

  @IsOptional()
  @IsString()
  scheduleCron?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
