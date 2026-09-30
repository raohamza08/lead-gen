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
  return (
    <div className="card card-interactive px-3.5 py-3" title={hint}>
      <div className="text-[11px] uppercase tracking-wide text-ink/55">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-ink">{value}</div>
      {deltaPct !== undefined && deltaPct !== null && (
        <div className="mt-0.5 flex items-center gap-1 text-[11px] text-ink/50">
          <span aria-hidden>{deltaPct > 0 ? "↑" : deltaPct < 0 ? "↓" : "→"}</span>
          {Math.abs(deltaPct).toFixed(1)}% vs previous period
        </div>
      )}
    </div>
  );
}
