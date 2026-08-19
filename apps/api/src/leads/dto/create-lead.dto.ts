import { IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString } from "class-validator";
import { LeadSourceLayer, PipelineStage } from "@leadgen/types";

/**
 * Payload the Claude lead-gen agent posts once a candidate clears verification
 * (Part C1/C3). orgId/runId/filterId are attached by the service from the
 * ExtractionRun context, not trusted from the request body.
 */
export class CreateLeadDto {
  @IsString()
  companyName!: string;

  /** Which method found this candidate. Omitted defaults to SURFACE_WEB
   *  (the only automated discovery method that exists) — see the enum's doc
   *  comment for why there's no "dark web" value to set here. */
  @IsOptional() @IsEnum(LeadSourceLayer) sourceLayer?: LeadSourceLayer;

  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() linkedinUrl?: string;
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() jobTitle?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() personalEmail?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() industry?: string;
  @IsOptional() @IsString() subNiche?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() companySize?: string;
  @IsOptional() @IsString() revenueBand?: string;
  @IsOptional() @IsInt() employeeCount?: number;
  @IsOptional() @IsArray() techStack?: { name: string; category?: string }[];
  @IsOptional() @IsString() businessModel?: string;
  @IsOptional() @IsString() b2bOrB2c?: string;
  @IsOptional() @IsString() businessDescription?: string;
  @IsOptional() @IsString() currentCrm?: string;

  // --- Technology & business intelligence gathered during discovery ---
  /** The contact's own profile, NOT the company page (that's linkedinUrl). */
  @IsOptional() @IsString() contactLinkedinUrl?: string;
  @IsOptional() @IsString() estimatedRevenue?: string;
  @IsOptional() @IsString() websitePlatform?: string;
  @IsOptional() @IsArray() automationTools?: string[];
  @IsOptional() @IsString() aiUsage?: string;
  @IsOptional() @IsArray() growthSignals?: string[];
  @IsOptional() @IsString() painPoints?: string;
  @IsOptional() @IsString() aiOpportunities?: string;
  @IsOptional() @IsString() automationOpportunities?: string;
  /** What the finder actually observed, so a reviewer can audit the claim. */
  @IsOptional() @IsString() researchEvidence?: string;

  // --- Company Intelligence Agent ---
  @IsOptional() swotAnalysis?: Record<string, string[]>;
  @IsOptional() @IsArray() competitors?: string[];
  @IsOptional() @IsArray() recentNews?: string[];
  @IsOptional() @IsArray() marketingStack?: string[];

  // --- Website Audit Agent ---
  @IsOptional() @IsString() uxIssues?: string;
  @IsOptional() @IsString() seoIssues?: string;

  // --- Buyer Intelligence Agent ---
  @IsOptional() @IsString() buyerPersona?: string;

  // Maturity and buyer scores. Separate from the six rubric dimensions because
  // they describe the company and the person, not the fit of the deal.
  @IsOptional() @IsInt() digitalMaturityScore?: number;
  @IsOptional() @IsInt() aiReadinessScore?: number;
  @IsOptional() @IsInt() automationOpportunityScore?: number;
  @IsOptional() @IsInt() authorityScore?: number;
  @IsOptional() @IsInt() engagementScore?: number;
  @IsOptional() @IsIn(["LOW", "MEDIUM", "HIGH"]) projectComplexity?: "LOW" | "MEDIUM" | "HIGH";

  @IsOptional() @IsBoolean() verifiedEmail?: boolean;
  @IsOptional() @IsBoolean() verifiedLinkedin?: boolean;
  @IsOptional() @IsBoolean() verifiedWebsite?: boolean;

  @IsOptional() @IsInt() leadScore?: number;
  @IsOptional() @IsInt() confidenceScore?: number;
  @IsOptional() @IsInt() aiOpportunityScore?: number;
  @IsOptional() @IsInt() automationScore?: number;
  @IsOptional() @IsInt() crmReadinessScore?: number;
  @IsOptional() @IsInt() websiteQualityScore?: number;

  // The remaining rubric dimensions plus the roll-up the pipeline ranks on.
  @IsOptional() @IsInt() businessFitScore?: number;
  @IsOptional() @IsInt() buyingIntentScore?: number;
  @IsOptional() @IsInt() budgetScore?: number;
  @IsOptional() @IsInt() technologyGapScore?: number;
  @IsOptional() @IsInt() decisionMakerAccessScore?: number;
  @IsOptional() @IsInt() leadPriorityScore?: number;

  @IsOptional() @IsString() fitReason?: string;
  @IsOptional() @IsString() suggestedServices?: string;
  @IsOptional() @IsNumber() expectedValue?: number;
  @IsOptional() @IsIn(["LOW", "MEDIUM", "HIGH"]) priority?: "LOW" | "MEDIUM" | "HIGH";

  @IsOptional() @IsString() filterId?: string;
  @IsOptional() @IsString() runId?: string;

  /**
   * Stage to start the lead at.
   *
   * A lead reaching this endpoint has already passed the verification agent,
   * and usually the research agent too, so starting it at NEW_LEAD would
   * misreport the funnel and force it through transitions that already
   * happened. The agent runner sets this to what actually completed; a
   * manually created lead omits it and starts at NEW_LEAD.
   */
  @IsOptional()
  @IsIn(Object.values(PipelineStage))
  initialStage?: PipelineStage;
}
