/**
 * The EurosHub loading identity (Part: UI/UX Redesign, 2026-09-01) —
 * "Orbit Ring": a fixed number of nodes arranged on a circle, connected by
 * segments that appear to travel around the ring. Reads as "data circulating
 * between connected systems" without being a literal brain/robot icon, and
 * without a generic spinner/three-dots/Material-style indicator.
 *
 * Deliberately CSS-only — no requestAnimationFrame, no per-frame JS. Two
 * keyframes do all the work: node opacity pulses on a staggered delay
 * (`pulse-node`), and each connecting segment's stroke-dashoffset animates
 * so a short dash appears to travel along it (`travel-segment`), phase-offset
 * per segment so the traveling dash reads as circling the ring clockwise.
 * Only opacity/stroke-dashoffset animate — cheap, and the element count is
 * fixed (6 or 12 nodes, matching segments) regardless of rendered size.
 *
 * Reduced-motion gets an explicit static fallback (a fully-drawn, fully-lit
 * ring) rather than relying on the app-wide `animation-duration: 0.01ms`
 * override, which would otherwise freeze mid-animation at whatever frame
 * happened to be painting — a coin-flip between "looks intentional" and
 * "looks half-erased." See the `.euroshub-loader` rule in app/globals.css.
 */

type Mode = "full-page" | "inline" | "button" | "agent";

const DEFAULT_SIZE: Record<Mode, number> = {
  "full-page": 96,
  inline: 32,
  button: 16,
  agent: 14,
};

const NODE_COUNT: Record<Mode, number> = {
  "full-page": 6,
  inline: 6,
  button: 3,
  agent: 3,
};

function ringPoints(count: number, cx: number, cy: number, r: number): { x: number; y: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2; // start at the top, matches a clock's 12
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
}

function OrbitRing({
  nodeCount,
  className,
  size,
}: {
  nodeCount: number;
  className: string;
  size: number;
}) {
  const cx = 50;
  const cy = 50;
  const r = 36;
  const points = ringPoints(nodeCount, cx, cy, r);
  const segmentLength = 2 * r * Math.sin(Math.PI / nodeCount); // chord length between adjacent nodes
  const staggerMs = 900 / nodeCount;

  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} aria-hidden focusable="false">
      {points.map((p, i) => {
        const next = points[(i + 1) % points.length];
        return (
          <line
            key={`seg-${i}`}
            x1={p.x}
            y1={p.y}
            x2={next.x}
            y2={next.y}
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={`${segmentLength * 0.28} ${segmentLength}`}
            className="euroshub-loader-segment"
            style={{ animationDelay: `${i * staggerMs}ms`, opacity: 0.85 }}
          />
        );
      })}
      {points.map((p, i) => (
        <circle
          key={`node-${i}`}
          cx={p.x}
          cy={p.y}
          r={4}
          fill="currentColor"
          className="euroshub-loader-node"
          style={{ animationDelay: `${i * staggerMs}ms` }}
        />
      ))}
    </svg>
  );
}

export function EurosHubLoader({
  mode = "inline",
  size,
  label,
  tone = "accent",
  title,
}: {
  mode?: Mode;
  size?: number;
  label?: string;
  /** agent mode only — matches AgentPulse's tone prop, which this mode replaces. */
  tone?: "accent" | "gold";
  /** agent mode only — matches AgentPulse's title prop. */
  title?: string;
}) {
  const resolvedSize = size ?? DEFAULT_SIZE[mode];
  const colorClass = tone === "gold" ? "text-gold" : "text-primary";

  if (mode === "agent") {
    return (
      <div className={`euroshub-loader flex items-center gap-1.5 text-[11px] ${colorClass}`} title={title}>
        <OrbitRing nodeCount={NODE_COUNT.agent} size={resolvedSize} className="shrink-0" />
        <span className="truncate">{label}</span>
      </div>
    );
  }

  if (mode === "button") {
    return (
      <span className={`euroshub-loader inline-flex shrink-0 items-center justify-center ${colorClass}`} role="status" aria-label={label ?? "Loading"}>
        <OrbitRing nodeCount={NODE_COUNT.button} size={resolvedSize} className="shrink-0" />
      </span>
    );
  }

  if (mode === "full-page") {
    return (
      <div role="status" aria-live="polite" className="flex flex-col items-center justify-center gap-3 py-16">
        <div className={`euroshub-loader ${colorClass}`}>
          <OrbitRing nodeCount={NODE_COUNT["full-page"]} size={resolvedSize} className="shrink-0" />
        </div>
        <span className="text-sm text-ink/50">{label ?? "Loading…"}</span>
      </div>
    );
  }

  // inline (default) — drop-in replacement for the old plain Spinner.
  return (
    <div className={`flex items-center gap-2 ${colorClass}`} role="status" aria-label={label ?? "Loading"}>
      <div className="euroshub-loader shrink-0">
        <OrbitRing nodeCount={NODE_COUNT.inline} size={resolvedSize} className="shrink-0" />
      </div>
      {label && <span className="text-sm text-ink/50">{label}</span>}
    </div>
  );
}
