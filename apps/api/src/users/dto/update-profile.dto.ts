import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(100) displayName?: string;
  @IsOptional() @IsString() @MaxLength(100) jobTitle?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  /** Rooms & Messages desktop "pending chat response" reminders (Part:
   *  Rooms & Messages desktop notifications, 2026-10-23). Self-managed,
   *  same as the fields above — not an admin-granted access flag. */
  @IsOptional() @IsBoolean() upworkChatReminderEnabled?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(240) upworkChatReminderThresholdMinutes?: number;
}
