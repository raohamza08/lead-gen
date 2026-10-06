import { UpworkAccountType, UpworkProposalStatus } from "@prisma/client";
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from "class-validator";

/** Everything an operator would ever edit after the initial submission.
 *  `projectHours` was the original exception worth calling out — editable
 *  even though it was part of the original form, since the real hour count
 *  for a project often isn't known until after it's won (Part: Upwork
 *  Requests, 2026-10-01). The detail modal (Part: Upwork proposal search,
 *  2026-10-06) widened this to every original-form field too — "update
 *  anything in it" means mistakes in the initial submission (wrong profile,
 *  job link, submitter) have to be fixable without deleting and
 *  re-submitting the row. */
export class UpdateUpworkProposalDto {
  @IsOptional() @IsEnum(UpworkProposalStatus) status?: UpworkProposalStatus;
  @IsOptional() @IsString() clientName?: string;
  @IsOptional() @IsString() closedBy?: string;
  @IsOptional() @IsString() clickupTaskId?: string;
  @IsOptional() @IsString() @MinLength(1) coverLetter?: string;
  @IsOptional() @IsNumber() @Min(0) projectHours?: number;

  @IsOptional() @IsString() @MinLength(1) profileName?: string;
  @IsOptional() @IsString() @MinLength(1) jobCategory?: string;
  @IsOptional() @IsString() @MinLength(1) jobLink?: string;
  @IsOptional() @IsString() @MinLength(1) submittedBy?: string;
  @IsOptional() @IsInt() @Min(0) connects?: number;
  @IsOptional() @IsEnum(UpworkAccountType) accountType?: UpworkAccountType;
}
