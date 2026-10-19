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
  | "THIS_WEEK"
  | "LAST_WEEK"
  | "LAST_7_DAYS"
  | "LAST_30_DAYS"
  | "THIS_MONTH"
  | "LAST_MONTH"
  | "THIS_QUARTER"
  | "THIS_YEAR"
  | "CUSTOM";

export type CompareMode = "last_month" | "previous_period";

export interface DashboardDateRange {
  range: DashboardDateRangeName;
  from: string; // YYYY-MM-DD, only meaningful when range === "CUSTOM"
  to: string;
  compare: boolean;
  compareMode: CompareMode;
}

const PRESETS: { value: DashboardDateRangeName; label: string }[] = [
  { value: "TODAY", label: "Today" },
  { value: "YESTERDAY", label: "Yesterday" },
  { value: "THIS_WEEK", label: "This week" },
  { value: "LAST_WEEK", label: "Last week" },
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

/** Defaults to the current calendar week, not a rolling window (Part:
 *  Dashboard Center, 2026-10-19, explicit user request — "the dashboards
 *  should have a date filter set to this week" + "the request hours
 *  calculations should be week wise... do not shift hours into the next or
 *  previous week"). A rolling LAST_30_DAYS/LAST_7_DAYS window has no week
 *  alignment: as days pass, hours drift in and out of it with no respect for
 *  week boundaries, and the Upwork tab's Requests card (which reuses this
 *  same shared range — see upwork.tsx) inherited that drift even though its
 *  own dedicated /upwork/requests page already defaulted to a real
 *  Monday-start calendar week. THIS_WEEK/LAST_WEEK resolve to non-overlapping
 *  calendar-week boundaries (see resolveDateRange's startOfWeek), so hours
 *  stay bucketed to the week they actually belong to.
 *
 *  Comparison defaults OFF (Part: premium dark theme pass v4, 2026-10-19,
 *  explicit user request — "the compare option should be off by default").
 *  Reverses a 2026-09-30 decision that deliberately defaulted it ON ("the
 *  previous period must be selected by the user, otherwise auto set to
 *  last month") — noted here so a future session doesn't read that old
 *  comment and "fix" this back without realizing it was already
 *  reconsidered. compareMode stays "last_month" so flipping the checkbox
 *  back on needs no further choice. The backend's own default (see
 *  resolveDashboardRange) is unchanged and still defaults compare ON
 *  server-side, but doesn't matter here: dashboardRangeToQuery always sends
 *  an explicit `compare=false` whenever the UI state is off (see below),
 *  which wins regardless of what the API would otherwise assume. */
export function defaultDashboardDateRange(): DashboardDateRange {
  const to = new Date();
  // Monday-start, mirrors resolveDateRange's startOfWeek on the API side —
  // only meaningful if the user later switches to CUSTOM, but should still
  // start from something sensible rather than the old rolling-30-day value.
  const from = new Date(to);
  const diff = (from.getDay() + 6) % 7; // days since Monday
  from.setDate(from.getDate() - diff);
  return { range: "THIS_WEEK", from: isoDate(from), to: isoDate(to), compare: false, compareMode: "last_month" };
}

/** Turns the shared date-range control into the {range, from, to, compare,
 *  compareMode} query params every /dashboard-center/* endpoint accepts
 *  (Part: Dashboard Center) — from/to are only meaningful (and only sent)
 *  when range === "CUSTOM", mirroring resolveDateRange's own CUSTOM
 *  handling on the API side. `compare` is only sent when explicitly turned
 *  off, since the backend already defaults to comparing against last month. */
export function dashboardRangeToQuery(range: DashboardDateRange): Record<string, string> {
  const params: Record<string, string> = { range: range.range };
  if (range.range === "CUSTOM") {
    params.from = range.from;
    params.to = range.to;
  }
  if (!range.compare) {
    params.compare = "false";
  } else {
    params.compareMode = range.compareMode;
  }
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
  // Pill controls (Part: Dashboard Center card-format match, 2026-10-19) —
  // rounded-full on a raised fill, matching the approved
  // dashboard-preview.html mockup's masthead controls, replacing the old
  // rounded-md/bg-transparent bordered boxes.
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <select
        value={value.range}
        onChange={(e) => onChange({ ...value, range: e.target.value as DashboardDateRangeName })}
        className="h-10 rounded-full border border-[var(--line)] bg-surface-elevated px-[18px] text-sm"
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
            className="h-10 rounded-full border border-[var(--line)] bg-surface-elevated px-4 text-xs"
          />
          <span className="text-xs text-ink/40">to</span>
          <input
            type="date"
            value={value.to}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
            className="h-10 rounded-full border border-[var(--line)] bg-surface-elevated px-4 text-xs"
          />
        </>
      )}
      <label className="flex items-center gap-1.5 text-xs text-ink/60">
        <input type="checkbox" checked={value.compare} onChange={(e) => onChange({ ...value, compare: e.target.checked })} />
        Compare to
      </label>
      {value.compare && (
        <select
          value={value.compareMode}
          onChange={(e) => onChange({ ...value, compareMode: e.target.value as CompareMode })}
          className="h-10 rounded-full border border-[var(--line)] bg-surface-elevated px-4 text-xs"
        >
          <option value="last_month">Last month</option>
          <option value="previous_period">Previous period (equal length)</option>
        </select>
      )}
    </div>
  );
}
