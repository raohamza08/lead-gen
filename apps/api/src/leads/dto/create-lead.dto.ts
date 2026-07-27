import { IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString } from "class-validator";

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

  @IsOptional() @IsBoolean() verifiedEmail?: boolean;
  @IsOptional() @IsBoolean() verifiedLinkedin?: boolean;
  @IsOptional() @IsBoolean() verifiedWebsite?: boolean;

  @IsOptional() @IsInt() leadScore?: number;
  @IsOptional() @IsInt() confidenceScore?: number;
  @IsOptional() @IsInt() aiOpportunityScore?: number;
  @IsOptional() @IsInt() automationScore?: number;
  @IsOptional() @IsInt() crmReadinessScore?: number;
  @IsOptional() @IsInt() websiteQualityScore?: number;
  @IsOptional() @IsString() fitReason?: string;
  @IsOptional() @IsString() suggestedServices?: string;
  @IsOptional() @IsNumber() expectedValue?: number;

  @IsOptional() @IsString() filterId?: string;
  @IsOptional() @IsString() runId?: string;
}
