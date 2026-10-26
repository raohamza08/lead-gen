import { UpworkProfileGroup } from "@prisma/client";
import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from "class-validator";

export class CreateFreelancerProfileDto {
  @IsString() @MinLength(1) name!: string;
  @IsString() @MinLength(1) niche!: string;
  /** Graphics vs Tech, for the Delayed Responses team inboxes (Part:
   *  Delayed Responses team inboxes, 2026-10-26). Optional — a profile
   *  with no group simply doesn't count toward either inbox yet. */
  @IsOptional() @IsEnum(UpworkProfileGroup) group?: UpworkProfileGroup;
}

export class UpdateFreelancerProfileDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() @MinLength(1) niche?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsEnum(UpworkProfileGroup) group?: UpworkProfileGroup;
}
