import { UpworkAccountType, UpworkProjectPricingType, UpworkProposalStatus, UpworkServiceFeeType } from "@prisma/client";
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
  @IsOptional() @IsEnum(UpworkProjectPricingType) pricingType?: UpworkProjectPricingType;

  @IsOptional() @IsString() @MinLength(1) profileName?: string;
  @IsOptional() @IsString() @MinLength(1) jobCategory?: string;
  @IsOptional() @IsString() @MinLength(1) jobLink?: string;
  @IsOptional() @IsString() @MinLength(1) submittedBy?: string;
  @IsOptional() @IsInt() @Min(0) connects?: number;
  @IsOptional() @IsEnum(UpworkAccountType) accountType?: UpworkAccountType;

  /** Earnings tracking (Part: Upwork earnings tracking, 2026-10-28).
   *  `serviceFeeAmount`/`netEarnings` are deliberately NOT settable here —
   *  UpworkService.resolveEarnings always derives them from these three
   *  inputs server-side, so a client can never desync net earnings from
   *  what gross/fee actually say. ADMIN/MANAGER only, enforced in the
   *  service (not a route-level @Roles guard — PATCH :id also carries
   *  every other, non-restricted field, so the check has to be
   *  per-field, not per-route). */
  @IsOptional() @IsNumber() @Min(0) clientEarnings?: number;
  @IsOptional() @IsEnum(UpworkServiceFeeType) serviceFeeType?: UpworkServiceFeeType;
  @IsOptional() @IsNumber() @Min(0) serviceFeeValue?: number;
}
