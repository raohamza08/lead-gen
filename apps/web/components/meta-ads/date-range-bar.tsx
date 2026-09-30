"use client";

export interface MetaAdsDateRange {
  from: string; // YYYY-MM-DD
  to: string;
  compare: boolean;
}

const PRESETS = [
  { label: "7d", days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function defaultMetaAdsDateRange(days = 30): MetaAdsDateRange {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: isoDate(from), to: isoDate(to), compare: false };
}

export function metaAdsRangeToQuery(range: MetaAdsDateRange): Record<string, string> {
  const params: Record<string, string> = { from: range.from, to: range.to };
  if (range.compare) params.compare = "true";
  return params;
}

/** The date-range selector every Meta Ads page shares — presets plus custom
 *  from/to, and the "compare to previous period" toggle that drives the
 *  overview's neutral (no good/bad coloring) delta display. Controlled from
 *  the parent page so each page can key its own queries off one shared
 *  range without a Context. */
export function MetaAdsDateRangeBar({ value, onChange }: { value: MetaAdsDateRange; onChange: (range: MetaAdsDateRange) => void }) {
  function applyPreset(days: number) {
    onChange({ ...defaultMetaAdsDateRange(days), compare: value.compare });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => applyPreset(p.days)}
            className="rounded-md border border-[var(--line)] px-2 py-1 text-xs text-ink/65 transition-colors hover:bg-ink/5"
          >
            {p.label}
          </button>
        ))}
      </div>
      <input
        type="date"
        value={value.from}
        onChange={(e) => onChange({ ...value, from: e.target.value })}
        className="rounded-md border border-[var(--line)] bg-transparent px-2 py-1 text-xs"
      />
      <span className="text-xs text-ink/40">to</span>
      <input
        type="date"
        value={value.to}
        onChange={(e) => onChange({ ...value, to: e.target.value })}
        className="rounded-md border border-[var(--line)] bg-transparent px-2 py-1 text-xs"
      />
      <label className="flex items-center gap-1.5 text-xs text-ink/60">
        <input type="checkbox" checked={value.compare} onChange={(e) => onChange({ ...value, compare: e.target.checked })} />
        Compare to previous period
      </label>
    </div>
  );
}
