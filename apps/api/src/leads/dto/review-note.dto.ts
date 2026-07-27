import { IsEnum, IsNumber, IsOptional, IsString } from "class-validator";
import { UrgencyLevel } from "@leadgen/types";

/** Human Review fields (Part F3 / F6) — the only fields a reviewer fills manually. */
export class ReviewNoteDto {
  @IsOptional() @IsString() websiteIssues?: string;
  @IsOptional() @IsString() businessProblems?: string;
  @IsOptional() @IsString() opportunities?: string;
  @IsOptional() @IsString() automationOpportunities?: string;
  @IsOptional() @IsString() crmIssues?: string;
  @IsOptional() @IsString() salesIssues?: string;
  @IsOptional() @IsString() marketingIssues?: string;
  @IsOptional() @IsString() operationalIssues?: string;
  @IsOptional() @IsString() suggestedService?: string;
  @IsOptional() @IsString() suggestedOffer?: string;
  @IsOptional() @IsString() suggestedCaseStudy?: string;
  @IsOptional() @IsString() suggestedHook?: string;
  @IsOptional() @IsString() painPoints?: string;
  @IsOptional() @IsEnum(UrgencyLevel) urgencyLevel?: UrgencyLevel;
  @IsOptional() @IsNumber() expectedValue?: number;
  @IsOptional() @IsString() notes?: string;
}
