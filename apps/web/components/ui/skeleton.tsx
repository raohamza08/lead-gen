/** Loading placeholder for tables/lists/cards (Part: UI/UX Redesign,
 *  2026-09-01) — a shimmer sweep, not the EurosHubLoader ring: a spinner per
 *  row reads as slow or broken for a multi-row table, while a shimmer reads
 *  as "rows incoming." See the `.skeleton` rule in app/globals.css.
 *  Generalizes the ad hoc `card h-32 animate-pulse` pattern already used on
 *  the Overview page — existing call sites are migrated in the module
 *  redesign phases, not here. */
export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={`skeleton rounded-md ${className}`} aria-hidden />;
}

/** A skeleton shaped like the app's standard `.card` — the common case of
 *  "a card-sized block hasn't loaded yet." */
export function SkeletonCard({ className = "h-32" }: { className?: string }) {
  return <div className={`card skeleton ${className}`} aria-hidden />;
}
