import { IsArray, IsBoolean, IsIn, IsOptional, IsString } from "class-validator";

/** V1 only ever sets triggerType "NEW_LEAD" — the one trigger that maps to
 *  something real in this codebase (see SocialAutomation's schema comment). */
export class CreateSocialAutomationDto {
  @IsString() name!: string;
  @IsIn(["NEW_LEAD"]) triggerType!: "NEW_LEAD";
  @IsArray() actions!: Array<Record<string, unknown>>;
  @IsOptional() conditions?: Record<string, unknown>;
}

export class UpdateSocialAutomationDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsArray() actions?: Array<Record<string, unknown>>;
  @IsOptional() conditions?: Record<string, unknown>;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class GenerateContentDto {
  @IsOptional() @IsIn(["generate", "repurpose"]) mode?: "generate" | "repurpose";
  @IsString() platform!: string;
  @IsOptional() @IsString() brief?: string;
  @IsOptional() @IsString() sourceContent?: string;
  @IsOptional() @IsString() sourcePlatform?: string;
  @IsOptional() @IsString() accountId?: string;
}
