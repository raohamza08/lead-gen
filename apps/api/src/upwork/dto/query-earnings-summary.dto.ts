import { IsInt, IsOptional, Max, Min } from "class-validator";
import { Type } from "class-transformer";

/** Part: Upwork earnings tracking, 2026-10-28. A specific calendar month,
 *  not one of the app's existing named ranges (THIS_MONTH/LAST_MONTH in
 *  ../../analytics/date-range.ts) — those are relative to "now" and the
 *  spec explicitly asks for "a month and year filter so the team can view
 *  earnings for any selected month", including past ones. Both optional;
 *  UpworkService.getEarningsSummary defaults to the server's current
 *  month/year, same "server time, no per-org timezone" convention
 *  date-range.ts itself documents. */
export class QueryEarningsSummaryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) month?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year?: number;
}
