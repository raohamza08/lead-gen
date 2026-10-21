import { IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";
import { Type } from "class-transformer";
import { DateRangeName } from "../../analytics/date-range";

const RANGE_NAMES: DateRangeName[] = [
  "TODAY", "YESTERDAY", "THIS_WEEK", "LAST_WEEK", "THIS_MONTH", "LAST_MONTH",
  "THIS_QUARTER", "THIS_YEAR", "LAST_7_DAYS", "LAST_30_DAYS", "LAST_90_DAYS", "CUSTOM", "ALL_TIME",
];

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
 *  behavior used when a comparison IS requested but no explicit window given.
 *
 *  `range`/`compareMode` (Part: Meta Ads dashboard fix, 2026-10-21, explicit
 *  user request — "I want the time filter the dropdown you added for other
 *  dashboards") mirror DashboardRangeQueryDto exactly, so the Dashboard
 *  Center's Meta Ads tab can use the same named-preset dropdown (Today/This
 *  week/This month/...) every other tab already uses, resolved the same
 *  way via resolveDashboardRange. Optional and additive — the standalone
 *  /meta-ads/campaigns, /adsets, /ads pages never send `range` and keep
 *  working exactly as before via the plain from/to/compare path. */
export class DateRangeQueryDto {
  @IsOptional() @IsIn(RANGE_NAMES) range?: DateRangeName;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsIn(["true", "false"]) compare?: string;
  @IsOptional() @IsDateString() compareFrom?: string;
  @IsOptional() @IsDateString() compareTo?: string;
  @IsOptional() @IsIn(["last_month", "previous_period"]) compareMode?: string;
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
