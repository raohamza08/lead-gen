"use client";

/** Named ranges mirror apps/api/src/analytics/date-range.ts's DateRangeName
 *  where they overlap (TODAY/YESTERDAY/THIS_WEEK/LAST_WEEK/THIS_MONTH/
 *  LAST_MONTH/CUSTOM) plus the two the Dashboard Center spec adds
 *  (THIS_QUARTER/THIS_YEAR) that the existing backend resolver doesn't
 *  support yet -- extending that resolver (not forking a second one) is
 *  part of wiring each dashboard's real endpoints, not this shell. */
export type DashboardDateRangeName =
  | "TODAY"
  | "YESTERDAY"
  | "LAST_7_DAYS"
  | "LAST_30_DAYS"
  | "THIS_MONTH"
  | "LAST_MONTH"
  | "THIS_QUARTER"
  | "THIS_YEAR"
  | "CUSTOM";

export interface DashboardDateRange {
  range: DashboardDateRangeName;
  from: string; // YYYY-MM-DD, only meaningful when range === "CUSTOM"
  to: string;
  compare: boolean;
}

const PRESETS: { value: DashboardDateRangeName; label: string }[] = [
  { value: "TODAY", label: "Today" },
  { value: "YESTERDAY", label: "Yesterday" },
  { value: "LAST_7_DAYS", label: "Last 7 days" },
  { value: "LAST_30_DAYS", label: "Last 30 days" },
  { value: "THIS_MONTH", label: "This month" },
  { value: "LAST_MONTH", label: "Last month" },
  { value: "THIS_QUARTER", label: "This quarter" },
  { value: "THIS_YEAR", label: "This year" },
  { value: "CUSTOM", label: "Custom" },
];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function defaultDashboardDateRange(): DashboardDateRange {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { range: "LAST_30_DAYS", from: isoDate(from), to: isoDate(to), compare: false };
}

/** Turns the shared date-range control into the {range, from, to, compare}
 *  query params every /dashboard-center/* endpoint accepts (Part:
 *  Dashboard Center) — from/to are only meaningful (and only sent) when
 *  range === "CUSTOM", mirroring resolveDateRange's own CUSTOM handling on
 *  the API side. */
export function dashboardRangeToQuery(range: DashboardDateRange): Record<string, string> {
  const params: Record<string, string> = { range: range.range };
  if (range.range === "CUSTOM") {
    params.from = range.from;
    params.to = range.to;
  }
  if (range.compare) params.compare = "true";
  return params;
}

/** The universal date filter every Dashboard Center page shares (Part:
 *  Dashboard Center spec section 1/14) — named presets plus a custom range
 *  and a "compare to previous period" toggle. Purely a UI control here;
 *  each dashboard's own data hook is responsible for turning this into
 *  actual query params against its endpoint. */
export function DashboardDateRangeBar({
  value,
  onChange,
}: {
  value: DashboardDateRange;
  onChange: (range: DashboardDateRange) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={value.range}
        onChange={(e) => onChange({ ...value, range: e.target.value as DashboardDateRangeName })}
        className="rounded-md border border-[var(--line)] bg-transparent px-2.5 py-1.5 text-sm"
      >
        {PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      {value.range === "CUSTOM" && (
        <>
          <input
            type="date"
            value={value.from}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
            className="rounded-md border border-[var(--line)] bg-transparent px-2 py-1.5 text-xs"
          />
          <span className="text-xs text-ink/40">to</span>
          <input
            type="date"
            value={value.to}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
            className="rounded-md border border-[var(--line)] bg-transparent px-2 py-1.5 text-xs"
          />
        </>
      )}
      <label className="flex items-center gap-1.5 text-xs text-ink/60">
        <input type="checkbox" checked={value.compare} onChange={(e) => onChange({ ...value, compare: e.target.checked })} />
        Compare to previous period
      </label>
    </div>
  );
}
