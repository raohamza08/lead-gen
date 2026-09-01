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
// privacy modes — falling through to the OS-preference default is fine.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var t = localStorage.getItem("theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
