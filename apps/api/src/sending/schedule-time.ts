/**
 * Pure, dependency-free "HH:mm in an IANA timezone" -> UTC Date helpers
 * (Part: Preparation Pipeline / Sending Queue, 2026-09-01). These are only
 * ever used to compute a display/storage value — the `scheduledAt` shown on
 * a WAITING_FOR_SCHEDULE message for the frontend countdown. The actual
 * firing mechanism is a real `cron` package CronJob constructed with the
 * same timezone (see SendingSchedulerService, mirroring NicheFiltersService)
 * — that already handles DST/timezone correctness natively, so this only
 * needs to be a good-enough estimate, never the authority on when a send
 * actually happens.
 */

function timezoneOffsetMs(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - date.getTime();
}

function zonedTimeToUtc(y: number, mo: number, d: number, h: number, mi: number, timezone: string): Date {
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi, 0));
  const offsetMs = timezoneOffsetMs(guess, timezone);
  return new Date(guess.getTime() - offsetMs);
}

/** Next occurrence of `sendTime` ("HH:mm") in `timezone` at or after `now`. */
export function nextDailyFireAfter(now: Date, sendTime: string, timezone: string): Date {
  const [hh, mm] = sendTime.split(":").map(Number);
  const calendarDay = (at: Date) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return { y: get("year"), mo: get("month"), d: get("day") };
  };

  const today = calendarDay(now);
  let target = zonedTimeToUtc(today.y, today.mo, today.d, hh, mm, timezone);
  if (target.getTime() <= now.getTime()) {
    const tomorrow = calendarDay(new Date(target.getTime() + 24 * 60 * 60 * 1000));
    target = zonedTimeToUtc(tomorrow.y, tomorrow.mo, tomorrow.d, hh, mm, timezone);
  }
  return target;
}

/** The single fire moment for a ONE_TIME schedule ("YYYY-MM-DD" + "HH:mm" in `timezone`). */
export function oneTimeFireDate(oneTimeDate: string, sendTime: string, timezone: string): Date {
  const [y, mo, d] = oneTimeDate.split("-").map(Number);
  const [hh, mm] = sendTime.split(":").map(Number);
  return zonedTimeToUtc(y, mo, d, hh, mm, timezone);
}
