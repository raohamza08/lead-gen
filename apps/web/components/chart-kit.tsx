"use client";

/**
 * Shared chart chrome. Everything visual that must be consistent across the
 * dashboard lives here so individual pages can't drift: the categorical slot
 * order, mark specs (bar cap, line width, marker size), recessive grid/axis
 * styling, and the table-view twin every chart is required to ship.
 */

import { ReactNode, useId, useState } from "react";
import { Cell, Pie, PieChart, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip } from "recharts";
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
}

/**
 * The WCAG-clean twin of a chart. Every value plotted must also be readable
 * here — a tooltip enhances, it never gates access to a number.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
}: {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
}) {
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
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className="border-b border-[var(--line)] last:border-0">
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
  size = 112,
}: {
  value: number;
  displayValue: string;
  label: string;
  color?: string;
  size?: number;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            data={[{ value: clamped }]}
            innerRadius="74%"
            outerRadius="100%"
            startAngle={90}
            endAngle={-270}
            barSize={8}
          >
            <RadialBar dataKey="value" cornerRadius={6} fill={color} background={{ fill: "var(--chart-grid)" }} isAnimationActive={false} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-semibold tracking-tight text-ink">{displayValue}</span>
        </div>
      </div>
      <span className="max-w-[9rem] text-center text-xs text-ink/60">{label}</span>
    </div>
  );
}

/** Groups a run of RadialProgress rings in one evenly-spaced row — the
 *  "Sales Statistics" / "Balance Statistics" pairing from the reference
 *  images, generalized to any count. */
export function RadialStrip({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap justify-around gap-6 py-2">{children}</div>;
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
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative shrink-0" style={{ width: 150, height: 150 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius={48} outerRadius={72} paddingAngle={2} strokeWidth={0} isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell key={d.label} fill={d.color ?? SERIES[i % SERIES.length]} />
              ))}
            </Pie>
            <Tooltip {...TOOLTIP_STYLE} formatter={(v: number, n: string) => [formatCompact(v), n]} />
          </PieChart>
        </ResponsiveContainer>
        {centerValue && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-base font-semibold tracking-tight text-ink">{centerValue}</span>
            {centerLabel && <span className="text-[11px] text-ink/55">{centerLabel}</span>}
          </div>
        )}
      </div>
      <ul className="flex min-w-[10rem] flex-1 flex-col gap-2">
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
