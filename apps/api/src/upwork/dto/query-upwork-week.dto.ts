import { IsIn, IsOptional, IsString } from "class-validator";
import { DateRangeName } from "../../analytics/date-range";

const RANGE_NAMES: DateRangeName[] = [
  "TODAY", "YESTERDAY", "THIS_WEEK", "LAST_WEEK", "THIS_MONTH", "LAST_MONTH",
  "THIS_QUARTER", "THIS_YEAR", "LAST_7_DAYS", "LAST_30_DAYS", "LAST_90_DAYS", "CUSTOM", "ALL_TIME",
];

/** Shared query shape for every Upwork Requests reporting endpoint (weekly
 *  target, Request vs Achievement, dashboard summary) — reuses the same
 *  named-range vocabulary as the rest of the Dashboard Center
 *  (DashboardRangeQueryDto) rather than inventing a second one, since
 *  resolveDateRange already supports THIS_WEEK/LAST_WEEK/CUSTOM directly
 *  (Part: Upwork Requests, 2026-10-01, spec section 7's "This Week / Last
 *  Week / Custom Date Range" filters). */
export class QueryUpworkWeekDto {
  @IsOptional() @IsIn(RANGE_NAMES) range?: DateRangeName;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() projectManagerId?: string;
  @IsOptional() @IsString() profileName?: string;
  @IsOptional() @IsIn(["BIDDING", "INVITE"]) source?: "BIDDING" | "INVITE";
}
