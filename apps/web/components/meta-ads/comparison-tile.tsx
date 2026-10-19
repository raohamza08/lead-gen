"use client";

/** KPI tile with an optional period-over-period delta — deliberately neutral
 *  (no green/red good-or-bad coloring): the module spec is explicit that an
 *  increase isn't inherently good or bad (e.g. rising spend, rising CPC), so
 *  this only shows direction and magnitude, in the same muted ink tone as
 *  everything else. */
export function ComparisonTile({
  label,
  value,
  deltaPct,
  hint,
}: {
  label: string;
  value: string;
  deltaPct?: number | null;
  hint?: string;
}) {
  // .kpi-cell, not a boxed card (Part: Dashboard Center card-format match,
  // 2026-10-19) — matches chart-kit.tsx's StatTile, which this otherwise
  // duplicates (kept separate only for the delta-direction arrow, a shape
  // StatTile's hint slot doesn't have). Always used inside a <KpiStrip>.
  return (
    <div className="kpi-cell" title={hint}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value text-ink">{value}</div>
      {deltaPct !== undefined && deltaPct !== null && (
        <div className="kpi-hint flex items-center gap-1">
          <span aria-hidden>{deltaPct > 0 ? "↑" : deltaPct < 0 ? "↓" : "→"}</span>
          {Math.abs(deltaPct).toFixed(1)}% vs previous period
        </div>
      )}
    </div>
  );
}
