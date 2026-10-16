import { UpworkAccountType, UpworkProjectPricingType, UpworkProposalType } from "@prisma/client";
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, MinLength, ValidateIf } from "class-validator";

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
  /** Hourly vs fixed-price (Part: Upwork Proposals fixed-price option,
   *  2026-10-16) — defaults to HOURLY server-side when omitted. */
  @IsOptional() @IsEnum(UpworkProjectPricingType) pricingType?: UpworkProjectPricingType;

  @IsOptional() @IsString() clickupTaskId?: string;

  /** Required for INVITE — every invite starts from a named client, so the
   *  form must collect it up front, not as an afterthought (Part: Upwork
   *  proposal search, 2026-10-06). Still optional for BIDDING, where the
   *  client is often unknown until later. */
  @ValidateIf((o) => o.type === UpworkProposalType.INVITE)
  @IsString()
  @MinLength(1, { message: "Client name is required for invites" })
  clientName?: string;
}
