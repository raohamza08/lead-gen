import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

export class PostVersionInputDto {
  @IsString() accountId!: string;
  @IsString() content!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) hashtags?: string[];
}

export class RecurrenceRuleDto {
  @IsIn(["DAILY", "WEEKLY", "MONTHLY"]) frequency!: "DAILY" | "WEEKLY" | "MONTHLY";
  @IsOptional() @IsArray() daysOfWeek?: number[];
  @IsOptional() @IsDateString() endDate?: string;
}

export class CreatePostDto {
  @IsOptional() @IsString() campaignId?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => PostVersionInputDto) versions!: PostVersionInputDto[];
  @IsOptional() @IsArray() @IsString({ each: true }) mediaAssetIds?: string[];
  @IsOptional() @IsDateString() scheduledAt?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @ValidateNested() @Type(() => RecurrenceRuleDto) recurrenceRule?: RecurrenceRuleDto;
  /** DRAFT (default) or PENDING_REVIEW to submit for approval immediately on creation. */
  @IsOptional() @IsIn(["DRAFT", "PENDING_REVIEW"]) status?: "DRAFT" | "PENDING_REVIEW";
}

export class UpdatePostDto {
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PostVersionInputDto) versions?: PostVersionInputDto[];
  @IsOptional() @IsArray() @IsString({ each: true }) mediaAssetIds?: string[];
  @IsOptional() @IsDateString() scheduledAt?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @ValidateNested() @Type(() => RecurrenceRuleDto) recurrenceRule?: RecurrenceRuleDto;
}

export class RejectPostDto {
  @IsString() reason!: string;
}

export class BulkScheduleRowDto {
  @IsArray() @IsString({ each: true }) accountIds!: string[];
  @IsString() content!: string;
  @IsDateString() scheduledAt!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) hashtags?: string[];
}

export class BulkScheduleDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => BulkScheduleRowDto) rows!: BulkScheduleRowDto[];
}
