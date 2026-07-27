export function KpiTile({ label, value, tone }: { label: string; value: string | number; tone?: "good" | "bad" | "gold" }) {
  const toneClass = tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : tone === "gold" ? "text-gold" : "text-ink";
  return (
    <div className="rounded-lg border border-[var(--line)] p-4">
      <div className="text-xs uppercase tracking-wide text-ink/60">{label}</div>
      <div className={`tabular mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
