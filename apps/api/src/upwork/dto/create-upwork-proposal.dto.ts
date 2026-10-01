import { UpworkAccountType, UpworkProposalType } from "@prisma/client";
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from "class-validator";

export class CreateUpworkProposalDto {
  @IsEnum(UpworkProposalType) type!: UpworkProposalType;

  @IsString() @MinLength(1) profileName!: string;
  @IsString() @MinLength(1) jobCategory!: string;
  @IsString() @MinLength(1) jobLink!: string;
  @IsString() @MinLength(1) coverLetter!: string;
  @IsString() @MinLength(1) submittedBy!: string;

  /** Bidding only (connects spent) — ignored server-side for INVITE. */
  @IsOptional() @IsInt() @Min(0) connects?: number;
  /** Bidding only (Training vs Live account) — ignored server-side for INVITE. */
  @IsOptional() @IsEnum(UpworkAccountType) accountType?: UpworkAccountType;

  /** Both BIDDING and INVITE (Part: Upwork Requests, 2026-10-01) — how many
   *  hours this project is worth, feeding the Upwork Dashboard's weekly
   *  onboarded-hours totals. Optional since it's often not known yet at
   *  submission time and only becomes real once the project is won. */
  @IsOptional() @IsNumber() @Min(0) projectHours?: number;

  @IsOptional() @IsString() clickupTaskId?: string;
  @IsOptional() @IsString() clientName?: string;
}
