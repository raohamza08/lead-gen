import { IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";
import { Type } from "class-transformer";

export class SelectMetaAdAccountsDto {
  @IsString() pendingId!: string;
  @IsArray() @IsString({ each: true }) externalAccountIds!: string[];
}

/** Shared by overview/timeseries/campaigns/adsets/ads — every read endpoint
 *  takes the same date window. `from`/`to` default to the trailing 30 days
 *  in the service layer when omitted, never silently to "all time" (Part:
 *  Error Handling — an empty reporting period must be a real, visible
 *  state, not returned by accident from an unbounded query). `compareFrom`/
 *  `compareTo` are optional — omitted means "no comparison requested",
 *  distinct from the service's own default "previous equal-length period"
 *  behavior used when a comparison IS requested but no explicit window given. */
export class DateRangeQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsIn(["true", "false"]) compare?: string;
  @IsOptional() @IsDateString() compareFrom?: string;
  @IsOptional() @IsDateString() compareTo?: string;
}

export class ListCampaignsQueryDto extends DateRangeQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() objective?: string;
  @IsOptional() @IsIn(["name", "spend", "impressions", "clicks", "ctr", "cpc", "cpm", "results", "roas"]) sortBy?: string;
  @IsOptional() @IsIn(["asc", "desc"]) sortDir?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}

export class ListAdSetsQueryDto extends ListCampaignsQueryDto {
  @IsOptional() @IsString() campaignId?: string;
}

export class ListAdsQueryDto extends ListCampaignsQueryDto {
  @IsOptional() @IsString() adSetId?: string;
  @IsOptional() @IsString() campaignId?: string;
}

export class TimeseriesQueryDto extends DateRangeQueryDto {
  @IsOptional() @IsString() campaignId?: string;
  @IsOptional() @IsString() adSetId?: string;
}
