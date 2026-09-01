import { EurosHubLoader } from "./ui/euroshub-loader";

/** Maps the handful of Tailwind size classes every real call site actually
 *  passes (confirmed via a full-codebase grep, Part: UI/UX Redesign,
 *  2026-09-01) to a pixel size for EurosHubLoader's `size` prop — kept
 *  narrow and explicit rather than parsing arbitrary class strings. */
const SIZE_BY_CLASSNAME: Record<string, number> = {
  "h-3 w-3": 12,
  "h-3.5 w-3.5": 14,
  "h-4 w-4": 16,
};

/** Shared loading indicator (Part: system-wide caching/loading states) —
 *  used wherever a query is fetching for the first time. Internals now
 *  render the EurosHubLoader "Orbit Ring" identity instead of a generic
 *  spin animation; every existing call site upgrades automatically since
 *  this file's exported names and props are unchanged (Part: UI/UX
 *  Redesign, 2026-09-01). */
export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <EurosHubLoader mode="button" size={SIZE_BY_CLASSNAME[className] ?? 16} label="Loading" />;
}

export function LoadingRow({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink/50">
      <EurosHubLoader mode="inline" size={24} />
      <span>{label}</span>
    </div>
  );
}

/** A live background process (an agent mid-run, a sync in progress) — one
 *  consistent visual for "this is happening right now" wherever the app has
 *  a real, backend-sourced signal to show it (never a decorative animation
 *  with no live state behind it — see Part: reliability overhaul,
 *  2026-08-31's "no fake realtime" principle). `tone` picks the loader/text
 *  color; defaults to the app's primary accent. */
export function AgentPulse({ label, tone = "accent", title }: { label: string; tone?: "accent" | "gold"; title?: string }) {
  return <EurosHubLoader mode="agent" label={label} tone={tone} title={title} />;
}
