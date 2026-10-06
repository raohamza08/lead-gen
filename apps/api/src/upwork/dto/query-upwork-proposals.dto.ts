import { UpworkProposalStatus, UpworkProposalType } from "@prisma/client";
import { IsEnum, IsOptional, IsString } from "class-validator";

export class QueryUpworkProposalsDto {
  @IsOptional() @IsEnum(UpworkProposalType) type?: UpworkProposalType;
  @IsOptional() @IsEnum(UpworkProposalStatus) status?: UpworkProposalStatus;
  @IsOptional() @IsString() submittedBy?: string;
  /** Free-text search across client name, submitter name, and profile name
   *  (Part: Upwork proposal search, 2026-10-06) — one box instead of three
   *  separate exact-match filters, since users think "who/what is this
   *  about", not which column it lives in. */
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
}
