import { IsEnum, IsString, MinLength } from "class-validator";
import { SocialPlatform } from "@prisma/client";

/** Registers an org's own OAuth app credentials for one platform (Part:
 *  per-account OAuth app credentials, 2026-09-07) — picked at "Connect"
 *  time instead of always using the platform-wide default (env vars). */
export class CreateSocialOAuthAppDto {
  @IsEnum(SocialPlatform) platform!: SocialPlatform;
  @IsString() @MinLength(1) name!: string;
  @IsString() @MinLength(1) clientId!: string;
  @IsString() @MinLength(1) clientSecret!: string;
}
