import { IsBoolean, IsIn, IsOptional } from "class-validator";

const SOUND_TONES = ["DEFAULT", "SOFT", "PROFESSIONAL", "MINIMAL", "ALERT", "NONE"] as const;

export class UpdateNotificationPreferencesDto {
  @IsOptional() @IsBoolean() inAppEnabled?: boolean;
  @IsOptional() @IsBoolean() desktopEnabled?: boolean;
  @IsOptional() @IsBoolean() soundEnabled?: boolean;
  @IsOptional() @IsIn(SOUND_TONES) soundTone?: (typeof SOUND_TONES)[number];
  @IsOptional() @IsBoolean() emailEnabled?: boolean;
  @IsOptional() @IsBoolean() leadsEnabled?: boolean;
  @IsOptional() @IsBoolean() agentsEnabled?: boolean;
  @IsOptional() @IsBoolean() automationsEnabled?: boolean;
  @IsOptional() @IsBoolean() socialEnabled?: boolean;
  @IsOptional() @IsBoolean() systemEnabled?: boolean;
}
