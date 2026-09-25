import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  Validate,
} from "class-validator";

/** Rejects timezone abbreviations (PKT, EST, IST...) up front instead of
 *  letting them reach `cron`/`Intl` and fail silently later — confirmed live,
 *  2026-09-25: an org's schedule stored "PKT" (not a real IANA zone), which
 *  made SendingSchedulerService's CronJob construction throw on every
 *  startup and silently never register, so the daily schedule never fired at
 *  all (fell back to sending immediately instead). `Intl` is the same
 *  authority `cron`/schedule-time.ts already trust at runtime, so validating
 *  with it here can't reject a zone that would have worked anyway. */
@ValidatorConstraint({ name: "isIanaTimeZone", async: false })
class IsIanaTimeZoneConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== "string") return false;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }

  defaultMessage(): string {
    return "timezone must be a real IANA zone name (e.g. Asia/Karachi, America/New_York) — not an abbreviation like PKT or EST";
  }
}

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
  @Validate(IsIanaTimeZoneConstraint)
  timezone?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "oneTimeDate must be YYYY-MM-DD" })
  oneTimeDate?: string;
}
