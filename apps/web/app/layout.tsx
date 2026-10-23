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
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var t = localStorage.getItem("theme");
    document.documentElement.setAttribute("data-theme", t === "dark" ? "dark" : "light");
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "light");
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
