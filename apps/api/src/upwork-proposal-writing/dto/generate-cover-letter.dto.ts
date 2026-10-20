import { Type } from "class-transformer";
import { IsArray, IsInt, IsObject, IsOptional, IsString, IsUrl, Min, MinLength, ValidateNested } from "class-validator";

/// Shape the browser-extension content script sends after scraping a job
/// page in the user's own real browser (Part: Upwork Bidding SOP, real-
/// world correction — Upwork's Cloudflare WAF hard-blocks this app's
/// server IP outright, confirmed by direct testing; the user's own browser
/// never gets flagged since it's a real residential session). Mirrors
/// FetchedJob's shape so it runs through the exact same SUCCESS pipeline
/// as a (hypothetical) server-side fetch would have.
export class ExtractedJobDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() postedAt?: string;
  @IsOptional() @IsObject() facts?: Record<string, string>;
  @IsOptional() @IsObject() client?: Record<string, string>;
  @IsOptional() @IsArray() @IsString({ each: true }) skills?: string[];
}

export class GenerateCoverLetterDto {
  @IsString() @IsUrl({ require_protocol: true }) jobUrl!: string;

  @IsOptional() @ValidateNested() @Type(() => ExtractedJobDto) extractedJob?: ExtractedJobDto;

  /// Manual-entry fallback (Part: Upwork Bidding SOP) — a human-typed
  /// substitute for when neither the server fetch nor the browser
  /// extension are available/installed. Kept alongside extractedJob above,
  /// not replaced by it — the extension needs installing first, so this
  /// stays the zero-setup fallback.
  @IsOptional() @IsString() manualTitle?: string;
  @IsOptional() @IsString() @MinLength(20) manualDescription?: string;
  @IsOptional() @IsString() manualBudget?: string;
  @IsOptional() @IsString() manualClientCountry?: string;
  @IsOptional() @IsString() manualClientTotalSpent?: string;
  @IsOptional() @IsInt() @Min(0) manualPostedMinutesAgo?: number;

  /// Typed in directly when the agency already knows this client's real
  /// name from a past engagement (Part: Upwork Proposal Writing, explicit
  /// user request — "the bot should find the client name from the
  /// previous jobs that were done"). Upwork's job page never exposes a
  /// name to scrape, so this is either supplied here or auto-matched
  /// server-side against an earlier draft for the same client (see
  /// ProposalWritingService.resolveClientName) — this field wins over
  /// that match when both are present, since an explicit human-confirmed
  /// name is more trustworthy than a heuristic.
  @IsOptional() @IsString() knownClientName?: string;
}
