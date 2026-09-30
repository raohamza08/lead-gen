import type { ReactNode } from "react";

/** Whether a bigger number is good news for this metric or not — drives
 *  which direction of change renders green vs red below. Most counts (more
 *  leads, more sent, more won) are higher-better; cost/loss/complaint-style
 *  metrics are lower-better. */
export type ComparisonDirection = "higher-better" | "lower-better";

/**
 * Colored period-over-period comparison, meant to be passed as a StatTile's
 * `hint` (Part: Dashboard Center, 2026-09-30 — "show the last month value in
 * green and red color: green if better, red if not"). This is a deliberate
 * departure from the app's earlier "never color a delta good/bad" stance
 * elsewhere (see ComparisonTile in Meta Ads) — the user explicitly asked
 * for judged coloring here, so it's scoped to Dashboard Center tiles that
 * pass this component rather than applied globally.
 */
export function ComparisonHint({
  deltaPct,
  previousValue,
  direction = "higher-better",
  label = "vs last month",
}: {
  deltaPct: number | null | undefined;
  /** Formatted previous-period value, e.g. "42" or "18.3%". */
  previousValue?: string;
  direction?: ComparisonDirection;
  label?: string;
}) {
  if (deltaPct === null || deltaPct === undefined) {
    return previousValue ? <span className="text-ink/45">{label}: {previousValue}</span> : null;
  }
  const improved = direction === "higher-better" ? deltaPct > 0 : deltaPct < 0;
  const worsened = direction === "higher-better" ? deltaPct < 0 : deltaPct > 0;
  const colorClass = improved ? "text-good" : worsened ? "text-bad" : "text-ink/45";
  const arrow = deltaPct > 0 ? "↑" : deltaPct < 0 ? "↓" : "→";
  return (
    <span className={colorClass}>
      {arrow} {Math.abs(deltaPct).toFixed(1)}% {label}
      {previousValue ? ` (was ${previousValue})` : ""}
    </span>
  );
}

/**
 * Shared content for a StatTile's drill-down modal (Part: Dashboard Center,
 * 2026-09-30 — "each tile that shows a value must be clickable and open a
 * modal with the data"). Every dashboard page builds one of these per tile
 * from data it already fetched, rather than each page hand-rolling its own
 * modal body layout.
 */
export function MetricDetail({
  definition,
  rows,
  footnote,
}: {
  /** Plain-language explanation of what the number means / how it's computed. */
  definition?: string;
  rows: { label: string; value: ReactNode }[];
  footnote?: string;
}) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      {definition && <p className="text-ink/70">{definition}</p>}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        {rows.map((r, i) => (
          <div key={i} className="contents">
            <dt className="text-ink/50">{r.label}</dt>
            <dd className="tabular text-right font-medium text-ink">{r.value}</dd>
          </div>
        ))}
      </dl>
      {footnote && <p className="text-[11px] text-ink/40">{footnote}</p>}
    </div>
  );
}
