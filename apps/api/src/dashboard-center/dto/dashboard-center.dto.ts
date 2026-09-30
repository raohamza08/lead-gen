import { IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from "class-validator";
import { Type } from "class-transformer";
import { DateRangeName } from "../../analytics/date-range";

const RANGE_NAMES: DateRangeName[] = [
  "TODAY", "YESTERDAY", "THIS_WEEK", "LAST_WEEK", "THIS_MONTH", "LAST_MONTH",
  "THIS_QUARTER", "THIS_YEAR", "LAST_7_DAYS", "LAST_30_DAYS", "LAST_90_DAYS", "CUSTOM", "ALL_TIME",
];

export class DashboardRangeQueryDto {
  @IsOptional() @IsIn(RANGE_NAMES) range?: DateRangeName;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsIn(["true", "false"]) compare?: string;
  @IsOptional() @IsIn(["last_month", "previous_period"]) compareMode?: string;
  @IsOptional() @IsString() ownerId?: string;
  @IsOptional() @IsString() nicheId?: string;
  @IsOptional() @IsString() campaignId?: string;
  @IsOptional() @IsString() sourceLayer?: string;
}

export class LeadsAuditQueryDto extends DashboardRangeQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}

export class CreateConnectPurchaseDto {
  @IsString() purchasedAt!: string;
  @IsNumber() connectsAmount!: number;
  @IsNumber() totalCost!: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() notes?: string;
}

export class SetBenchmarkDto {
  @IsString() metricKey!: string;
  @IsNumber() targetValue!: number;
}

export class ImportConnectPurchasesDto {
  @IsString() csv!: string;
}
