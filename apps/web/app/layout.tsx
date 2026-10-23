import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Outly OS",
  description: "AI-powered lead generation & client acquisition platform",
};

// Runs before first paint so dark mode never flashes light-then-dark on
// load (Part: UI/UX Redesign, 2026-09-01) — components/theme-toggle.tsx sets
// data-theme entirely client-side via a post-hydration effect, which left a
// real gap between first paint and that effect running. Inlined rather than
// imported so it's guaranteed to execute synchronously as a blocking script
// tag, matching what libraries like next-themes do internally (none is
// installed here). Wrapped in try/catch since localStorage can throw in some
// privacy modes.
//
// Defaults to dark when there's no stored choice (Part: premium dark theme
// pass v4 fix, 2026-10-19 — real bug, not a style change). Previously this
// fell through to `@media (prefers-color-scheme: dark)`, which only applies
// dark mode to visitors whose OS/browser already prefers dark. Every visible
// change from this session's four theme passes — the coral accent, the
// near-black canvas, the matte grain, the glass overlays — only exists in
// the dark palette; light mode was deliberately left as the original teal
// theme throughout (see memory). A user on a default-light system (the
// common case) saw none of it, confirmed live: logging in with a fresh
// browser profile (no stored preference) rendered the untouched light
// theme. An explicit "light" or "dark" choice via the in-app toggle
// (components/theme-toggle.tsx) always wins over this default.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var t = localStorage.getItem("theme");
    document.documentElement.setAttribute("data-theme", t === "light" ? "light" : "dark");
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* No webfont link needed (Part: full UI redesign per UI.md,
            2026-10-23) — Segoe UI is a system font on Windows; everywhere
            else falls through to tailwind.config.ts's fontFamily.sans
            system-font fallback stack. */}
      </head>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
