import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, ValidateNested } from "class-validator";
import { AgentReviewDto } from "./agent-review.dto";

/**
 * Enrichment results the AI workers post back for a lead that already exists —
 * CreateLeadDto's counterpart for a brand-new one. Used by the manual-lead
 * pipeline (Part: manual lead enrichment), which researches and scores a
 * hand-entered lead the same way discovery does, just against a lead row that
 * already exists instead of one about to be created.
 *
 * Every field is optional and only supplied ones are written — see
 * LeadsService.applyEnrichment — so a degraded agent (e.g. the website audit
 * found nothing) leaves the existing value alone instead of overwriting good
 * data with null, exactly like _map_intelligence_fields on the Python side.
 */
export class ApplyEnrichmentDto {
  // --- Company/website/buyer intelligence ---
  @IsOptional() @IsString() businessDescription?: string;
  @IsOptional() @IsString() currentCrm?: string;
  @IsOptional() @IsArray() techStack?: { name: string; category?: string }[];
  @IsOptional() @IsArray() growthSignals?: string[];
  @IsOptional() swotAnalysis?: Record<string, string[]>;
  @IsOptional() @IsArray() competitors?: string[];
  @IsOptional() @IsArray() recentNews?: string[];
  @IsOptional() @IsString() websitePlatform?: string;
  @IsOptional() @IsString() uxIssues?: string;
  @IsOptional() @IsString() seoIssues?: string;
  @IsOptional() @IsString() buyerPersona?: string;
  @IsOptional() @IsString() painPoints?: string;
  @IsOptional() @IsString() aiOpportunities?: string;
  @IsOptional() @IsString() automationOpportunities?: string;

  // --- Verification (deterministic checks, not LLM output) ---
  @IsOptional() @IsBoolean() verifiedEmail?: boolean;
  @IsOptional() @IsBoolean() verifiedLinkedin?: boolean;
  @IsOptional() @IsBoolean() verifiedWebsite?: boolean;

  // --- Scoring rubric ---
  @IsOptional() @IsInt() leadScore?: number;
  @IsOptional() @IsInt() confidenceScore?: number;
  @IsOptional() @IsInt() aiOpportunityScore?: number;
  @IsOptional() @IsInt() automationScore?: number;
  @IsOptional() @IsInt() crmReadinessScore?: number;
  @IsOptional() @IsInt() websiteQualityScore?: number;
  @IsOptional() @IsInt() businessFitScore?: number;
  @IsOptional() @IsInt() buyingIntentScore?: number;
  @IsOptional() @IsInt() budgetScore?: number;
  @IsOptional() @IsInt() technologyGapScore?: number;
  @IsOptional() @IsInt() decisionMakerAccessScore?: number;
  @IsOptional() @IsInt() leadPriorityScore?: number;
  @IsOptional() @IsInt() digitalMaturityScore?: number;
  @IsOptional() @IsInt() aiReadinessScore?: number;
  @IsOptional() @IsInt() automationOpportunityScore?: number;
  @IsOptional() @IsInt() authorityScore?: number;
  @IsOptional() @IsInt() engagementScore?: number;
  @IsOptional() @IsIn(["LOW", "MEDIUM", "HIGH"]) projectComplexity?: "LOW" | "MEDIUM" | "HIGH";
  @IsOptional() @IsString() fitReason?: string;
  @IsOptional() @IsString() suggestedServices?: string;
  @IsOptional() @IsNumber() expectedValue?: number;
  @IsOptional() @IsIn(["LOW", "MEDIUM", "HIGH"]) priority?: "LOW" | "MEDIUM" | "HIGH";

  // --- AI's own review note, mirroring the human review fields ---
  @IsOptional()
  @ValidateNested()
  @Type(() => AgentReviewDto)
  agentReview?: AgentReviewDto;
}
