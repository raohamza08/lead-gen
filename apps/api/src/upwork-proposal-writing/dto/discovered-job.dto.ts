import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsObject, IsOptional, IsString, IsUrl, ValidateNested } from "class-validator";

export class DiscoveredJobEntryDto {
  @IsString() @IsUrl({ require_protocol: true }) jobUrl!: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() postedAt?: string;
  @IsOptional() @IsObject() facts?: Record<string, string>;
  @IsOptional() @IsObject() client?: Record<string, string>;
  @IsOptional() @IsArray() @IsString({ each: true }) skills?: string[];
}

export class IngestDiscoveredJobsDto {
  /// Capped — the extension already limits a single scan to a reasonable
  /// number of jobs (tab-opening is sequential and visible to the user);
  /// this is a second, server-side backstop against a malformed payload.
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => DiscoveredJobEntryDto)
  jobs!: DiscoveredJobEntryDto[];
}
