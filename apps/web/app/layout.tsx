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
// Defaults to light when there's no stored choice (Part: full UI redesign
// per UI.md, 2026-10-23 — reverses the previous "default to dark" fix).
// That earlier fix existed because every visible change from the old
// premium theme passes only existed in the dark palette, and light mode
// had been left on the untouched original teal theme — defaulting dark
// was the only way a fresh visitor actually saw that work. The situation
// is now the opposite: UI.md's spec is a pixel-measured capture of
// Outlook Web's LIGHT theme (that's the only rendering it documents) —
// dark mode is this app's own reasonable-but-invented complement to it,
// not something the spec itself defines. Defaulting to light is what
// actually shows a fresh visitor "exactly as per the md file." An
// explicit "light"/"dark"/"system" choice via the in-app toggle
// (components/theme-toggle.tsx) always wins over this default.
// Same flash problem, same fix, for the org-wide accent color (Part: accent
// FOUC fix, 2026-10-23 — reported by the primary admin: on reload, the
// built-in blue (#0F6CBD, globals.css's --accent-rgb default) painted
// first, then snapped to the org's actual custom color once
// components/accent-picker.tsx's colorQuery resolved — a real network
// round-trip, unlike the theme's localStorage-only read above. accent-picker
// has no way to read the authoritative value synchronously (it lives in the
// database), so this mirrors the only trick available: cache the last-known
// hex in localStorage (accent-picker now does this on every successful
// fetch/mutation) and apply it here, before first paint. Self-corrects once
// the real query resolves a moment later, so a stale cache (e.g. changed
// from a different browser) only ever shows for an instant, never wrong
// forever. A brand-new browser with nothing cached yet still sees one flash
// on its very first load — unavoidable without SSR, same tradeoff the
// theme script above already accepts.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var t = localStorage.getItem("theme");
    document.documentElement.setAttribute("data-theme", t === "dark" ? "dark" : "light");
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "light");
  }
  try {
    var hex = localStorage.getItem("org-accent-color");
    if (hex) {
      var m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
      if (m) {
        var n = parseInt(m[1], 16);
        var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
        var triplet = r + " " + g + " " + b;
        var style = document.documentElement.style;
        style.setProperty("--accent-rgb", triplet);
        style.setProperty("--accent-2-rgb", triplet);
        var lin = [r, g, b].map(function (c) {
          var s = c / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        });
        var luminance = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
        style.setProperty("--accent-contrast-rgb", luminance > 0.45 ? "20 16 13" : "255 255 255");
      }
    }
  } catch (e) {}
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
