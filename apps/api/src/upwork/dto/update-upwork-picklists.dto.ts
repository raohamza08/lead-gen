import { IsArray, IsOptional, IsString } from "class-validator";

/** Admin-managed option lists for the Bidding/Invite forms (Part: Upwork
 *  picklists, 2026-09-29) — a submitter picks from these, they don't free-type,
 *  so the reporting tables never fragment over "Ahmad" vs "ahmad" vs "Ahmed". */
export class UpdateUpworkPicklistsDto {
  @IsOptional() @IsArray() @IsString({ each: true }) categories?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) submitters?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) profiles?: string[];
}
