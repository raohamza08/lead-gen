/** Shared loading indicator (Part: system-wide caching/loading states) —
 *  used wherever a query is fetching for the first time. Kept intentionally
 *  small/inline rather than a full-page overlay, since with caching in
 *  place most revisits show cached data instantly and only a genuinely
 *  fresh fetch (or background refetch) should show this at all. */
export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin text-ink/40 ${className}`} viewBox="0 0 24 24" fill="none" aria-label="Loading">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export function LoadingRow({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink/50">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

/** A live background process (an agent mid-run, a sync in progress) — a
 *  pulsing dot plus label, one consistent visual for "this is happening
 *  right now" wherever the app has a real, backend-sourced signal to show
 *  it (never a decorative animation with no live state behind it — see
 *  Part: reliability overhaul, 2026-08-31's "no fake realtime" principle).
 *  `tone` picks the dot/text color; defaults to the app's accent. */
export function AgentPulse({ label, tone = "accent", title }: { label: string; tone?: "accent" | "gold"; title?: string }) {
  const color = tone === "gold" ? "bg-gold text-gold" : "bg-accent text-accent";
  const [dotColor, textColor] = color.split(" ");
  return (
    <div className={`flex items-center gap-1.5 text-[11px] ${textColor}`} title={title}>
      <span className={`h-1.5 w-1.5 shrink-0 animate-pulse rounded-full ${dotColor}`} />
      <span className="truncate">{label}</span>
    </div>
  );
}
