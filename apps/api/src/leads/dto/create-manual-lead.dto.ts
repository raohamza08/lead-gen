import { IsEmail, IsInt, IsOptional, IsString, Min, MinLength } from "class-validator";

/**
 * A lead typed in by a human.
 *
 * Deliberately much smaller than CreateLeadDto: scores, verification flags and
 * agent research are NOT accepted here. A person entering a company knows its
 * name and website, not its AI opportunity score — accepting those fields would
 * let hand-entered guesses sit in the same columns as measured values and be
 * indistinguishable from them in every downstream report.
 *
 * Enrichment and scoring happen afterwards by running the agents against it.
 */
export class CreateManualLeadDto {
  @IsString()
  @MinLength(2)
  companyName!: string;

  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() linkedinUrl?: string;
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() jobTitle?: string;
  // Validated as an email so a typo is caught at entry rather than becoming a
  // bounce that damages the sending domain's reputation.
  @IsOptional() @IsEmail({}, { message: "email must be a valid address" }) email?: string;
  @IsOptional() @IsEmail({}, { message: "personalEmail must be a valid address" }) personalEmail?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() contactLinkedinUrl?: string;
  @IsOptional() @IsString() industry?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsInt() @Min(0) employeeCount?: number;
  @IsOptional() @IsString() businessDescription?: string;
  @IsOptional() @IsString() campaignId?: string;
  /** Free-text note explaining why this lead was added by hand. */
  @IsOptional() @IsString() notes?: string;
}
