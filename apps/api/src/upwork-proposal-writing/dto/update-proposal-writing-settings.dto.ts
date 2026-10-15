import { IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class UpdateProposalWritingSettingsDto {
  @IsOptional() @IsString() agencyBackground?: string;
  @IsOptional() @IsString() instructions?: string;
  @IsOptional() @IsInt() @Min(30) @Max(500) wordCountTarget?: number;
}
