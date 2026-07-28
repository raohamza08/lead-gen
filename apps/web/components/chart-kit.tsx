"use client";

/**
 * Shared chart chrome. Everything visual that must be consistent across the
 * dashboard lives here so individual pages can't drift: the categorical slot
 * order, mark specs (bar cap, line width, marker size), recessive grid/axis
 * styling, and the table-view twin every chart is required to ship.
 */

import { ReactNode, useId, useState } from "react";

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

export function SectionCard({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--line)] p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-ink/55">{subtitle}</p> : null}
        </div>
        {actions}
      </div>
      {children}
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
  chart,
  table,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  chart: ReactNode;
  table: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  const panelId = useId();

  return (
    <SectionCard
      title={title}
      subtitle={subtitle}
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

/** Label + value, with an optional tone. The number is the chart. */
export function StatTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "good" | "bad" | "gold";
}) {
  const toneClass =
    tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : tone === "gold" ? "text-gold" : "text-ink";
  return (
    <div className="rounded-lg border border-[var(--line)] px-3.5 py-3">
      <div className="text-[11px] uppercase tracking-wide text-ink/55">{label}</div>
      {/* Proportional figures, not tabular — these are standalone values, not a column. */}
      <div className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-ink/45">{hint}</div> : null}
    </div>
  );
}
