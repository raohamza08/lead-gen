"use client";

/**
 * Shared chart chrome. Everything visual that must be consistent across the
 * dashboard lives here so individual pages can't drift: the categorical slot
 * order, mark specs (bar cap, line width, marker size), recessive grid/axis
 * styling, and the table-view twin every chart is required to ship.
 */

import { ReactNode, useId, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Modal } from "./ui/modal";

/**
 * The categorical palette, in fixed slot order. Assign by index and never
 * cycle — a fifth series folds into "Other" or gets faceted instead, because
 * generated hues past the validated set aren't CVD-separable.
 *
 * Colour follows the entity, not its rank: pass a stable index per series so
 * filtering one out never repaints the survivors.
 */
export const SERIES = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
] as const;

/** Single-series marks use the brand accent — one series, one colour. */
export const SINGLE_SERIES = "var(--accent)";

/** Small inline line icons for StatCardWithSparkline tiles (Part: Dashboard
 *  Center, 2026-10-20, explicit user request — "i want the dashboards like
 *  this one" extended to every tab, not just Website Analytics, after the
 *  first pass only touched that one page). Hand-rolled SVGs, matching this
 *  app's existing convention (sidebar-nav.tsx, theme-toggle.tsx) rather
 *  than an icon library dependency for a dozen glyphs. One object so every
 *  tab imports from the same place instead of redefining its own set. */
const ICON_PROPS = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
export const DashboardIcons = {
  Users: () => (
    <svg aria-hidden {...ICON_PROPS}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  Pulse: () => (
    <svg aria-hidden {...ICON_PROPS}>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  ),
  Eye: () => (
    <svg aria-hidden {...ICON_PROPS}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  Clock: () => (
    <svg aria-hidden {...ICON_PROPS}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  ),
  Mail: () => (
    <svg aria-hidden {...ICON_PROPS}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 6-10 7L2 6" />
    </svg>
  ),
  Dollar: () => (
    <svg aria-hidden {...ICON_PROPS}>
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  Chat: () => (
    <svg aria-hidden {...ICON_PROPS}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  Briefcase: () => (
    <svg aria-hidden {...ICON_PROPS}>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  ),
  Funnel: () => (
    <svg aria-hidden {...ICON_PROPS}>
      <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3Z" />
    </svg>
  ),
  Check: () => (
    <svg aria-hidden {...ICON_PROPS}>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
  X: () => (
    <svg aria-hidden {...ICON_PROPS}>
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6M9 9l6 6" />
    </svg>
  ),
  TrendingUp: () => (
    <svg aria-hidden {...ICON_PROPS}>
      <path d="m23 6-9.5 9.5-5-5L1 18" />
      <path d="M17 6h6v6" />
    </svg>
  ),
  Target: () => (
    <svg aria-hidden {...ICON_PROPS}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  ),
  Inbox: () => (
    <svg aria-hidden {...ICON_PROPS}>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
    </svg>
  ),
  Layers: () => (
    <svg aria-hidden {...ICON_PROPS}>
      <path d="m12 2 10 6-10 6L2 8z" />
      <path d="m2 16 10 6 10-6" />
      <path d="m2 12 10 6 10-6" />
    </svg>
  ),
} as const;

/** Recessive chrome: solid hairlines one step off the surface, never dashed. */
export const AXIS_PROPS = {
  stroke: "var(--chart-axis)",
  tick: { fontSize: 11, fill: "var(--ink-muted)" },
  tickLine: false,
} as const;

export const GRID_PROPS = {
  stroke: "var(--chart-grid)",
  strokeWidth: 1,
  vertical: false,
} as const;

export const TOOLTIP_STYLE = {
  contentStyle: {
    background: "var(--paper)",
    border: "1px solid var(--line)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--ink)",
  },
  labelStyle: { color: "var(--ink)", fontWeight: 600, marginBottom: 4 },
  itemStyle: { color: "var(--ink)" },
  cursor: { fill: "rgb(var(--ink-rgb) / 0.05)" },
} as const;

export function formatCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 1000)}K`;
  return value.toLocaleString();
}

/** Small four-corners icon for the SectionCard expand button — distinct from
 *  Modal's own close X so the two are never confused mid-interaction. */
function ExpandIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"
        stroke="currentColor"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SectionCard({
  title,
  subtitle,
  actions,
  expandable,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** When true, an expand button renders the same content full-size inside
   *  a modal (Part: Dashboard Center, 2026-09-30 — "each section must be
   *  clickable and open a modal with the data"). Reuses the exact `children`
   *  already being rendered inline, not a second fetch — both copies read
   *  the same already-loaded query data. */
  expandable?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    // p-6 (24px), not p-5 — matches the approved dashboard-preview.html
    // mockup's --pad token exactly (Part: Dashboard Center card-format
    // match, 2026-10-19).
    <section className="card p-6">
      <div className="mb-[18px] flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* Back to text-base/text-xs (Part: Dashboard Center readability
              pass round 2, 2026-10-22, explicit user request — "not make it
              bigger... make it small, clean... too much bold"). The
              previous pass's text-lg/text-sm bump went the wrong direction. */}
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-ink/55">{subtitle}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {expandable && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              title="Expand"
              aria-label={`Expand ${title}`}
              className="rounded-md border border-[var(--line)] p-1.5 text-ink/60 transition-colors hover:bg-ink/5"
            >
              <ExpandIcon />
            </button>
          )}
        </div>
      </div>
      {children}
      {expandable && (
        <Modal open={open} onOpenChange={setOpen} title={title} contentClassName="w-full max-w-4xl">
          {subtitle ? <p className="mb-4 text-xs text-ink/55">{subtitle}</p> : null}
          {children}
        </Modal>
      )}
    </section>
  );
}

export interface TableColumn<T> {
  key: string;
  header: string;
  /** Renders the cell. Numbers should stay right-aligned via `numeric`. */
  render: (row: T) => ReactNode;
  numeric?: boolean;
  /** Opt a column into click-header-to-sort (Part: table sort rollout,
   *  2026-10-27, explicit user request — "make sure all the tables are in
   *  tabular form with all the options to filter, sort etc in it"). Returns
   *  the raw comparable value for this row — separate from `render` since
   *  that returns JSX (a badge, a link, formatted text) that can't be
   *  compared directly. A column with no `sortValue` just isn't sortable —
   *  existing call sites that don't set this are unaffected. Sorting is
   *  client-side over whatever `rows` this render received, same as every
   *  other DataTable behavior; for a server-paginated table that only sorts
   *  the current page, not the full server-side result set. */
  sortValue?: (row: T) => string | number | null | undefined;
}

/**
 * The WCAG-clean twin of a chart. Every value plotted must also be readable
 * here — a tooltip enhances, it never gates access to a number.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
}: {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  /** Opt-in (Part: click-through detail views, 2026-10-23, explicit user
   *  request — "it should be clickable so i can click and see all the
   *  details in it") — every other DataTable call site is unaffected,
   *  rows only become clickable when a caller passes this. */
  onRowClick?: (row: T) => void;
}) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);

  function toggleSort(col: TableColumn<T>) {
    if (!col.sortValue) return;
    setSort((prev) => {
      if (prev?.key !== col.key) return { key: col.key, dir: "asc" };
      if (prev.dir === "asc") return { key: col.key, dir: "desc" };
      return null; // desc -> unsorted, back to original row order
    });
  }

  const sortedRows = (() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls last regardless of direction
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  })();

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] border-collapse text-xs">
        <thead>
          <tr className="border-b border-[var(--line)]">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={`whitespace-nowrap px-3 py-2 font-medium text-ink/55 ${
                  col.numeric ? "text-right" : "text-left"
                }`}
              >
                {col.sortValue ? (
                  <button
                    type="button"
                    onClick={() => toggleSort(col)}
                    className={`flex items-center gap-1 text-inherit ${col.numeric ? "ml-auto" : ""}`}
                  >
                    {col.header}
                    {sort?.key === col.key && (
                      <span aria-hidden className="text-[10px]">
                        {sort.dir === "asc" ? "▲" : "▼"}
                      </span>
                    )}
                  </button>
                ) : (
                  col.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-[var(--line)] last:border-0 ${onRowClick ? "cursor-pointer transition-colors hover:bg-ink/[0.04]" : ""}`}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`whitespace-nowrap px-3 py-2 ${
                    col.numeric ? "tabular text-right" : "text-left"
                  }`}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A chart and its table view behind one toggle.
 *
 * This isn't a nicety: three of the four light-mode series colours sit below
 * 3:1 against the page surface, and the relief rule for that is a visible
 * label set or a table view. The toggle is the table view.
 */
export function ChartWithTable({
  title,
  subtitle,
  actions,
  expandable,
  chart,
  table,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  expandable?: boolean;
  chart: ReactNode;
  table: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  const panelId = useId();

  return (
    <SectionCard
      title={title}
      subtitle={subtitle}
      expandable={expandable}
      actions={
        <div className="flex items-center gap-2">
          {actions}
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            aria-expanded={showTable}
            aria-controls={panelId}
            className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5"
          >
            {showTable ? "View chart" : "View table"}
          </button>
        </div>
      }
    >
      <div id={panelId}>{showTable ? table : chart}</div>
    </SectionCard>
  );
}

/**
 * The identity channel that doesn't depend on colour discrimination. Always
 * rendered for two or more series; a single-series chart gets none, since its
 * title already names what's plotted.
 */
export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-xs text-ink/70">
          <span
            aria-hidden
            className="h-0.5 w-4 rounded-full"
            style={{ background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** A single-metric progress ring: a track + an arc filled to `value` percent,
 *  with the number set in the center rather than beside it (Part: Dashboard
 *  Center real-chart pass, 2026-10-19, explicit user request — two reference
 *  images of generic dashboard-template graphics, asked to match the visual
 *  language with this app's own data and colors, not the reference's
 *  magenta/cyan palette). Built on recharts' RadialBarChart with a single
 *  bar rather than a hand-drawn SVG arc, so it inherits the same
 *  tooltip-free, axis-free simplicity as every other chart-kit primitive.
 *  `value` drives the fill (0–100, clamped); `displayValue` is the string
 *  shown in the center and is independent of `value` so a caller can pass a
 *  formatted value (e.g. "64.2%") that doesn't round-trip cleanly back to a
 *  fill percentage. Color follows the SAME accent/series tokens as every
 *  other chart here — never the reference image's own hues. */
export function RadialProgress({
  value,
  displayValue,
  label,
  color = SINGLE_SERIES,
  size = 164,
}: {
  value: number;
  displayValue: string;
  label: string;
  color?: string;
  size?: number;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="flex flex-col items-center gap-2.5">
      <div className="relative" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            data={[{ value: clamped }]}
            innerRadius="76%"
            outerRadius="100%"
            startAngle={90}
            endAngle={-270}
            barSize={10}
          >
            <RadialBar dataKey="value" cornerRadius={7} fill={color} background={{ fill: "var(--chart-grid)" }} isAnimationActive={false} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-2xl font-semibold tracking-tight text-ink">{displayValue}</span>
        </div>
      </div>
      <span className="max-w-[10rem] text-center text-xs text-ink/60">{label}</span>
    </div>
  );
}

/** Groups a run of RadialProgress rings in one row, centered as a block
 *  (Part: Dashboard Center sizing pass, 2026-10-20, explicit user request —
 *  "I want the graphs to be a little bigger, center aligned and of same
 *  size" — the first version used `justify-around`, which spreads 1-2 rings
 *  across the full card width instead of clustering them in the middle). */
export function RadialStrip({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap justify-center gap-10 py-2">{children}</div>;
}

/** An icon'd KPI tile with its own accent color and an embedded trend
 *  sparkline (Part: Dashboard Center, 2026-10-20, explicit user request — a
 *  reference screenshot: "i want the dashboards like this one"). Each
 *  instance gets a left accent bar, a tinted icon badge, a delta pill, and
 *  a small gradient-filled area chart along the bottom built from the SAME
 *  real per-day series the page's main trend chart already fetched — no
 *  separate request, so a tile's sparkline can never disagree with the big
 *  chart below it. `sparklineData`/`dataKey` follow the same shape
 *  ChartWithTable's own charts use (an array of point objects + the field
 *  name to plot), so a caller just passes its existing timeseries rows. */
export function StatCardWithSparkline({
  icon,
  label,
  value,
  deltaPct,
  color,
  sparklineData,
  dataKey,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  deltaPct?: number | null;
  color: string;
  sparklineData: Record<string, number | string>[];
  dataKey: string;
}) {
  const gradientId = useId();
  return (
    <div className="card overflow-hidden p-0" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="flex items-start justify-between gap-2 p-4 pb-2">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}
          >
            {icon}
          </span>
          <div>
            <div className="text-xs text-ink/55">{label}</div>
            <div className="text-xl font-semibold tracking-tight text-ink">{value}</div>
          </div>
        </div>
        {deltaPct !== undefined && deltaPct !== null && (
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
              deltaPct >= 0 ? "bg-good/15 text-good" : "bg-bad/15 text-bad"
            }`}
          >
            {deltaPct >= 0 ? "↑" : "↓"} {Math.abs(deltaPct).toFixed(0)}%
          </span>
        )}
      </div>
      {sparklineData.length > 1 && (
        <ResponsiveContainer width="100%" height={48}>
          <AreaChart data={sparklineData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5} fill={`url(#${gradientId})`} isAnimationActive={false} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

/** A single-metric trend card: big value, delta pill, and a full-size
 *  labeled area chart underneath (Part: Dashboard Center, 2026-10-20) —
 *  the reference screenshot's "Users over time" / "Sessions over time"
 *  row, one card per metric rather than cramming several series onto one
 *  chart. Same real data as StatCardWithSparkline's embedded sparklines,
 *  just rendered larger with axes. */
/** Every duration a MiniTrendCard's own selector can offer — a subset of
 *  DateRangeName (apps/api/src/analytics/date-range.ts) deliberately kept
 *  short to what's useful for a SINGLE chart's own window, not the full
 *  page-level range picker's list. */
export const TREND_DURATION_OPTIONS = [
  { value: "LAST_7_DAYS", label: "7D" },
  { value: "LAST_30_DAYS", label: "30D" },
  { value: "LAST_90_DAYS", label: "90D" },
  { value: "THIS_MONTH", label: "This month" },
  { value: "THIS_QUARTER", label: "This quarter" },
] as const;

const CHART_TYPE_ICON: Record<"area" | "line" | "bar", ReactNode> = {
  area: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17 9 9l4 4 8-10" />
      <path d="M3 21h18" />
    </svg>
  ),
  line: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17 9 9l4 4 8-10" />
    </svg>
  ),
  bar: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="12" width="4" height="8" />
      <rect x="10" y="7" width="4" height="13" />
      <rect x="16" y="3" width="4" height="17" />
    </svg>
  ),
};

/** A single-metric trend card: big value, delta pill, a labeled chart
 *  underneath, and — unlike a plain static chart — a type switcher
 *  (area/line/bar, swapping how the SAME already-loaded data renders) and
 *  an optional duration switcher (Part: Dashboard Center, 2026-10-20,
 *  explicit user request — "there should be an option in each chart to
 *  change the chart to any other chart and then there should be option in
 *  each chart to change the duration time for the single chart"). The type
 *  switch is pure client-side re-render, always on, zero extra cost. The
 *  duration switch is deliberately NOT self-fetching: chart-kit has no
 *  opinion on which API a given chart's data comes from (GA4, Email,
 *  MetaAds timeseries endpoints all have different shapes), so it just
 *  renders the control and calls `onDurationChange` — the CALLER owns the
 *  actual refetch (its own react-query call with a duration-keyed
 *  queryKey), same as every other query in this app. Omit
 *  `durationOptions`/`onDurationChange` for a chart with no independent
 *  duration concept (e.g. a chart already scoped to an all-time window). */
export function MiniTrendCard({
  label,
  value,
  deltaPct,
  color,
  data,
  dataKey,
  xKey,
  axisProps,
  gridProps,
  tooltipProps,
  xAxisProps,
  duration,
  durationOptions,
  onDurationChange,
  loading,
}: {
  label: string;
  value: string;
  deltaPct?: number | null;
  color: string;
  data: Record<string, number | string>[];
  dataKey: string;
  xKey: string;
  axisProps: typeof AXIS_PROPS;
  gridProps: typeof GRID_PROPS;
  tooltipProps: typeof TOOLTIP_STYLE;
  xAxisProps?: Record<string, unknown>;
  duration?: string;
  durationOptions?: readonly { value: string; label: string }[];
  onDurationChange?: (value: string) => void;
  loading?: boolean;
}) {
  const gradientId = useId();
  const [chartType, setChartType] = useState<"area" | "line" | "bar">("area");

  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink">{label}</span>
        <div className="flex items-center gap-2">
          <span className="tabular text-base font-semibold text-ink">{value}</span>
          {deltaPct !== undefined && deltaPct !== null && (
            <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${deltaPct >= 0 ? "bg-good/15 text-good" : "bg-bad/15 text-bad"}`}>
              {deltaPct >= 0 ? "↑" : "↓"} {Math.abs(deltaPct).toFixed(0)}%
            </span>
          )}
        </div>
      </div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-0.5 rounded-md border border-[var(--line)] p-0.5">
          {(["area", "line", "bar"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setChartType(t)}
              aria-label={`Show as ${t} chart`}
              aria-pressed={chartType === t}
              className={`flex h-5 w-6 items-center justify-center rounded transition-colors ${chartType === t ? "bg-ink/10 text-ink" : "text-ink/40 hover:text-ink/70"}`}
            >
              {CHART_TYPE_ICON[t]}
            </button>
          ))}
        </div>
        {durationOptions && onDurationChange && (
          <select
            value={duration}
            onChange={(e) => onDurationChange(e.target.value)}
            disabled={loading}
            className="h-6 rounded-md border border-[var(--line)] bg-transparent px-1.5 text-[11px] text-ink/70 disabled:opacity-50"
          >
            {durationOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        )}
      </div>
      <ResponsiveContainer width="100%" height={140}>
        {chartType === "bar" ? (
          <BarChart data={data}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey={xKey} {...axisProps} {...xAxisProps} />
            <Bar dataKey={dataKey} fill={color} radius={[3, 3, 0, 0]} />
            <Tooltip {...tooltipProps} />
          </BarChart>
        ) : chartType === "line" ? (
          <LineChart data={data}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey={xKey} {...axisProps} {...xAxisProps} />
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} />
            <Tooltip {...tooltipProps} />
          </LineChart>
        ) : (
          <AreaChart data={data}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey={xKey} {...axisProps} {...xAxisProps} />
            <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#${gradientId})`} dot={false} />
            <Tooltip {...tooltipProps} />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/** A categorical breakdown as a donut + a value/percentage legend (Part:
 *  Dashboard Center real-chart pass, 2026-10-19) — the reference images'
 *  "Trafic Sources" pattern: real counts in `data`, this component computes
 *  each slice's share of the total itself rather than taking a pre-computed
 *  percentage, so it can never drift from the numbers shown in the legend
 *  next to it. Falls back to a plain empty-state message when every value is
 *  zero (an all-zero donut renders as a meaningless full-circle in the
 *  track color, worse than just saying so). */
export function DonutBreakdown({
  data,
  centerLabel,
  centerValue,
}: {
  data: { label: string; value: number; color?: string }[];
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total <= 0) {
    return <p className="py-8 text-center text-xs text-ink/45">No data for this period.</p>;
  }
  return (
    // Centered as a block, not stretched (Part: Dashboard Center sizing
    // pass, 2026-10-20, explicit user request — "I want the graphs to be a
    // little bigger, center aligned and of same size"). The legend's old
    // `flex-1` made it stretch to fill whatever was left of the card after
    // a fixed-width donut, which is exactly what produced the huge dead
    // gutter on a short 2-4-item legend; dropping flex-1 and centering the
    // donut+legend pair as one unit fixes both the gutter and the
    // off-center placement at once. Donut itself bumped 150px -> 208px,
    // same ratio of ring thickness to diameter as before, scaled up.
    <div className="flex justify-center">
      <div className="flex flex-wrap items-center gap-8">
        <div className="relative shrink-0" style={{ width: 208, height: 208 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="label" innerRadius={66} outerRadius={100} paddingAngle={2} strokeWidth={0} isAnimationActive={false}>
                {data.map((d, i) => (
                  <Cell key={d.label} fill={d.color ?? SERIES[i % SERIES.length]} />
                ))}
              </Pie>
              <Tooltip {...TOOLTIP_STYLE} formatter={(v: number, n: string) => [formatCompact(v), n]} />
            </PieChart>
          </ResponsiveContainer>
          {centerValue && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-semibold tracking-tight text-ink">{centerValue}</span>
              {centerLabel && <span className="text-xs text-ink/55">{centerLabel}</span>}
            </div>
          )}
        </div>
        <ul className="flex w-[14rem] flex-col gap-2">
          {data.map((d, i) => (
            <li key={d.label} className="flex items-center gap-2 text-xs">
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: d.color ?? SERIES[i % SERIES.length] }} />
              <span className="text-ink/70">{d.label}</span>
              <span className="tabular ml-auto font-medium text-ink">{formatCompact(d.value)}</span>
              <span className="tabular w-10 text-right text-ink/45">{Math.round((d.value / total) * 100)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Groups StatTiles into one divided strip — a hairline between cells
 *  instead of boxed/gapped tiles (Part: Dashboard Center card-format match,
 *  2026-10-19, matching the approved dashboard-preview.html mockup). Every
 *  dashboard tab's old `<div className="grid grid-cols-N gap-3">` wrapper
 *  around a run of `<StatTile>`s becomes `<KpiStrip>`; StatTile itself
 *  renders the `.kpi-cell` the strip divides. */
export function KpiStrip({ children }: { children: ReactNode }) {
  return <div className="kpi-strip">{children}</div>;
}

/** Splits a formatted value like "4.2%" or "$43,255.38" into a bold whole
 *  part and a dimmed decimal tail — the mockup's balance-figure convention
 *  (Part: Dashboard Center card-format match, 2026-10-19), applied generally
 *  here since `format.ts`'s `pct()`/`money()` already produce exactly this
 *  shape and every call site can keep passing a plain string. Anything that
 *  isn't "stuff, then a decimal point, then digits, then an optional
 *  suffix" (a plain integer, a "—" placeholder, a non-numeric string) is
 *  returned unchanged. */
function renderValue(value: string | number): ReactNode {
  if (typeof value === "number") return value;
  const m = /^(.*\d)(\.\d+)([^\d]*)$/.exec(value);
  if (!m) return value;
  const [, whole, decimal, suffix] = m;
  return (
    <>
      {whole}
      <span className="font-normal text-ink/50">{decimal}</span>
      {suffix}
    </>
  );
}

/** Label + value, with an optional tone. The number is the chart.
 *
 *  Optionally clickable (Part: Email Campaign dashboard, 2026-09-29) — when
 *  `onClick` is given, the tile renders as a real `<button>` instead of a
 *  `<div>` so it's keyboard/screen-reader operable, and `active` marks the
 *  selected tile for ones that double as tab selectors (e.g. "Sent"
 *  filtering the message-activity list below it) with a tinted background,
 *  not a ring (Part: Dashboard Center card-format match, 2026-10-19 — a
 *  ring read as an error/focus state against the new flush, borderless
 *  cell). Both are optional and default to the plain static tile every
 *  existing caller already uses. */
export function StatTile({
  label,
  value,
  hint,
  tone,
  onClick,
  active,
  detail,
}: {
  label: string;
  value: string | number;
  /** Plain string for a static note, or a ReactNode (e.g. ComparisonHint)
   *  for a colored period-over-period comparison. */
  hint?: ReactNode;
  tone?: "good" | "bad" | "gold";
  onClick?: () => void;
  active?: boolean;
  /** When given (and `onClick` isn't), the tile becomes clickable and opens
   *  a modal showing this content — typically the raw numbers/definition
   *  behind the value (Part: Dashboard Center, 2026-09-30 — "each tile that
   *  shows a value must be clickable and open a modal with the data"). Uses
   *  data already on the page, no extra fetch. */
  detail?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const toneClass =
    tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : tone === "gold" ? "text-gold" : "text-ink";
  const body = (
    <>
      <div className="kpi-label">{label}</div>
      {/* Proportional figures, not tabular — these are standalone values, not a column. */}
      <div className={`kpi-value ${toneClass}`}>{renderValue(value)}</div>
      {hint ? <div className="kpi-hint">{hint}</div> : null}
    </>
  );
  if (!onClick && !detail) {
    return <div className="kpi-cell">{body}</div>;
  }
  return (
    <>
      <button
        type="button"
        onClick={onClick ?? (() => setOpen(true))}
        aria-pressed={onClick ? active : undefined}
        className={`kpi-cell kpi-cell-interactive ${active ? "kpi-cell-active" : ""}`}
      >
        {body}
      </button>
      {detail && (
        <Modal open={open} onOpenChange={setOpen} title={label} contentClassName="w-full max-w-lg">
          {detail}
        </Modal>
      )}
    </>
  );
}
