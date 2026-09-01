import { IsBoolean, IsIn, IsOptional, IsString, Matches } from "class-validator";

export class UpsertSendingScheduleDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(["DAILY", "ONE_TIME"])
  frequency?: "DAILY" | "ONE_TIME";

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "sendTime must be HH:mm" })
  sendTime?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "oneTimeDate must be YYYY-MM-DD" })
  oneTimeDate?: string;
}
