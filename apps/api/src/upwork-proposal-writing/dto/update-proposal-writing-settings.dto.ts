import { IsArray, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class UpdateProposalWritingSettingsDto {
  @IsOptional() @IsString() agencyBackground?: string;
  @IsOptional() @IsString() instructions?: string;
  @IsOptional() @IsInt() @Min(30) @Max(1000) technicalWordLimit?: number;
  @IsOptional() @IsInt() @Min(30) @Max(1000) nonTechnicalWordLimit?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) excludedCountries?: string[];
  @IsOptional() @IsInt() @Min(0) @Max(24) newClientWindowMonths?: number;
  @IsOptional() @IsInt() @Min(0) @Max(50) minHiresPerYear?: number;
}
