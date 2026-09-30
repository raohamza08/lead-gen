import { formatCompact } from "../chart-kit";

/** Shared number formatting for Dashboard Center pages — `undefined` always
 *  renders as "—" (data unavailable), never 0, matching the API's own
 *  safeRate/safeDivide convention (Part: Dashboard Center). */
export function num(n: number | undefined | null): string {
  return n === undefined || n === null ? "—" : formatCompact(n);
}

export function pct(n: number | undefined | null): string {
  return n === undefined || n === null ? "—" : `${n.toFixed(1)}%`;
}

export function money(n: number | undefined | null, currency = "USD"): string {
  if (n === undefined || n === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
}

export function minutes(n: number | undefined | null): string {
  if (n === undefined || n === null) return "—";
  if (n < 60) return `${Math.round(n)}m`;
  if (n < 1440) return `${(n / 60).toFixed(1)}h`;
  return `${(n / 1440).toFixed(1)}d`;
}

export function dateTime(iso: string | Date): string {
  return new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Title-cases a SCREAMING_SNAKE_CASE enum value for display, e.g.
 *  "MEETING_BOOKED" -> "Meeting Booked". Used across every Dashboard Center
 *  page for PipelineStage/EmailEventType/etc. rather than a bespoke label
 *  map per enum, since the enum names are already descriptive. */
export function titleCase(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
