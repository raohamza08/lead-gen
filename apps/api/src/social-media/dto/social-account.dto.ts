import { IsArray, IsBoolean, IsEnum, IsOptional, IsString } from "class-validator";
import { SocialPlatform } from "@prisma/client";

/** Creates a placeholder account row before OAuth even runs (schema's own
 *  "Add Account lets you configure defaults before connecting" comment) —
 *  connecting later fills in externalAccountId/status via the OAuth callback. */
export class CreateSocialAccountDto {
  @IsEnum(SocialPlatform) platform!: SocialPlatform;
  @IsString() username!: string;
  @IsOptional() @IsString() displayName?: string;
}

export class UpdateSocialAccountSettingsDto {
  @IsOptional() @IsString() displayName?: string;
  @IsOptional() @IsString() defaultTimezone?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) defaultHashtags?: string[];
  @IsOptional() @IsString() defaultCta?: string;
  @IsOptional() @IsString() brandVoice?: string;
  @IsOptional() @IsBoolean() approvalRequired?: boolean;
}

export class GrantSocialAccountAccessDto {
  @IsString() userId!: string;
  @IsOptional() @IsBoolean() canView?: boolean;
  @IsOptional() @IsBoolean() canPublish?: boolean;
  @IsOptional() @IsBoolean() canApprove?: boolean;
}
