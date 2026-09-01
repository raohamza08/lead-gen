/**
 * Animation tokens (Part: UI/UX Redesign, 2026-09-01) — the JS-side mirror of
 * the duration/easing CSS variables in app/globals.css (--duration-fast etc,
 * --ease-standard etc) and the matching Tailwind utilities in
 * tailwind.config.ts. Needed only where JS timing has to match a CSS
 * transition exactly — e.g. delaying an unmount until a Modal/Popover's exit
 * animation finishes — not for styling, which should use the CSS vars or
 * Tailwind utilities directly.
 */
export const DURATION = {
  fast: 120,
  normal: 200,
  slow: 320,
} as const;

export const EASE = {
  standard: "cubic-bezier(0.4, 0, 0.2, 1)",
  decelerate: "cubic-bezier(0, 0, 0.2, 1)",
  accelerate: "cubic-bezier(0.4, 0, 1, 1)",
} as const;

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
