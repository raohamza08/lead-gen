import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Bound to the CSS variables in app/globals.css rather than fixed hex, so
      // dark mode actually reaches Tailwind-coloured text. `<alpha-value>` is
      // what keeps opacity modifiers like `text-ink/60` working.
      colors: {
        paper: "rgb(var(--paper-rgb) / <alpha-value>)",
        ink: "rgb(var(--ink-rgb) / <alpha-value>)",
        accent: "rgb(var(--accent-rgb) / <alpha-value>)",
        gold: "rgb(var(--gold-rgb) / <alpha-value>)",
        good: "rgb(var(--good-rgb) / <alpha-value>)",
        bad: "rgb(var(--bad-rgb) / <alpha-value>)",
        // Semantic aliases (Part: UI/UX Redesign, 2026-09-01) — additive only,
        // every one of these points at a channel already declared above/in
        // globals.css. Nothing here replaces the original names, which stay
        // in wide use across the app; these exist so new components/ui/*
        // files can read as intent ("bg-surface", "text-error") rather than
        // requiring every author to know paper=background, bad=error, etc.
        background: "rgb(var(--paper-rgb) / <alpha-value>)",
        surface: "rgb(var(--surface-rgb) / <alpha-value>)",
        "surface-elevated": "rgb(var(--surface-raised-rgb) / <alpha-value>)",
        primary: "rgb(var(--accent-rgb) / <alpha-value>)",
        secondary: "rgb(var(--secondary-rgb) / <alpha-value>)",
        success: "rgb(var(--good-rgb) / <alpha-value>)",
        warning: "rgb(var(--gold-rgb) / <alpha-value>)",
        error: "rgb(var(--bad-rgb) / <alpha-value>)",
        info: "rgb(var(--info-rgb) / <alpha-value>)",
        border: "rgb(var(--ink-rgb) / <alpha-value>)",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      // Typography scale (Part: UI/UX Redesign, 2026-09-01) — names sizes
      // already in production use rather than inventing new ones, so this is
      // a consistency pass, not a new design: `display` is Overview's hero
      // text-5xl, `section-title` is the card-header text-sm font-semibold
      // tracking-tight pattern used on every card, `label` is the
      // text-[11px] uppercase tracking-wide stat-tile label pattern, and
      // `numeric-lg` is the text-2xl font-semibold tracking-tight stat value
      // pattern — all four already appear verbatim on the Overview page.
      fontSize: {
        display: ["2.5rem", { lineHeight: "1.15", fontWeight: "600", letterSpacing: "-0.02em" }],
        "page-title": ["1.375rem", { lineHeight: "1.3", fontWeight: "600", letterSpacing: "-0.01em" }],
        "section-title": ["0.875rem", { lineHeight: "1.4", fontWeight: "600" }],
        label: ["0.6875rem", { lineHeight: "1.3", fontWeight: "500", letterSpacing: "0.02em" }],
        metadata: ["0.75rem", { lineHeight: "1.4" }],
        "numeric-lg": ["1.5rem", { lineHeight: "1.2", fontWeight: "600", letterSpacing: "-0.01em" }],
      },
      // Mirrors the --duration-*/--ease-* CSS vars in globals.css so the same
      // three durations and three easings are reachable as Tailwind
      // utilities (duration-fast, ease-standard) for components that don't
      // need a raw CSS transition string.
      transitionDuration: {
        fast: "120ms",
        normal: "200ms",
        slow: "320ms",
      },
      transitionTimingFunction: {
        standard: "cubic-bezier(0.4, 0, 0.2, 1)",
        decelerate: "cubic-bezier(0, 0, 0.2, 1)",
        accelerate: "cubic-bezier(0.4, 0, 1, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
