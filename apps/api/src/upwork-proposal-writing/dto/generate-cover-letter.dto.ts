import { IsInt, IsOptional, IsString, IsUrl, Min, MinLength } from "class-validator";

export class GenerateCoverLetterDto {
  @IsString() @IsUrl({ require_protocol: true }) jobUrl!: string;

  /// Manual-entry fallback (Part: Upwork Bidding SOP, real-world correction
  /// — Upwork's Cloudflare bot detection hard-blocks this app's VPS IP
  /// outright, confirmed by direct testing from that exact server; no
  /// browser-fingerprint tweak fixes an IP-reputation block). When
  /// `manualDescription` is present, ProposalWritingService skips the
  /// Playwright fetch entirely and builds the job from these fields
  /// instead, so a blocked automatic fetch doesn't leave the user stuck.
  @IsOptional() @IsString() manualTitle?: string;
  @IsOptional() @IsString() @MinLength(20) manualDescription?: string;
  @IsOptional() @IsString() manualBudget?: string;
  @IsOptional() @IsString() manualClientCountry?: string;
  @IsOptional() @IsString() manualClientTotalSpent?: string;
  @IsOptional() @IsInt() @Min(0) manualPostedMinutesAgo?: number;
}
