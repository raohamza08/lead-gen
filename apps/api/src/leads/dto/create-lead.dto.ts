import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString } from "class-validator";

/**
 * Payload the Claude lead-gen agent posts once a candidate clears verification
 * (Part C1/C3). orgId/runId/filterId are attached by the service from the
 * ExtractionRun context, not trusted from the request body.
 */
export class CreateLeadDto {
  @IsString()
  companyName!: string;

  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() linkedinUrl?: string;
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() jobTitle?: string;
  @IsOptional() @IsString() email?: string;
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
}
