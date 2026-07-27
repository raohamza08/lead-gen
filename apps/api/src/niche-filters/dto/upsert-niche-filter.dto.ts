import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Min } from "class-validator";

export class UpsertNicheFilterDto {
  @IsString()
  niche!: string;

  @IsOptional()
  @IsString()
  subNiche?: string;

  @IsOptional()
  @IsArray()
  countries?: string[];

  @IsOptional()
  @IsArray()
  cities?: string[];

  @IsOptional()
  @IsInt()
  companySizeMin?: number;

  @IsOptional()
  @IsInt()
  companySizeMax?: number;

  @IsOptional()
  @IsString()
  revenueBandMin?: string;

  @IsOptional()
  @IsString()
  revenueBandMax?: string;

  @IsOptional()
  @IsInt()
  employeeCountMin?: number;

  @IsOptional()
  @IsInt()
  employeeCountMax?: number;

  @IsOptional()
  @IsArray()
  jobTitles?: string[];

  @IsOptional()
  @IsArray()
  technologies?: string[];

  @IsOptional()
  @IsString()
  fundingStage?: string;

  @IsOptional()
  @IsString()
  businessModel?: string;

  @IsOptional()
  @IsString()
  b2bOrB2c?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  dailyTarget?: number;

  @IsOptional()
  @IsArray()
  sourcePriority?: string[];

  @IsOptional()
  @IsString()
  scheduleCron?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
