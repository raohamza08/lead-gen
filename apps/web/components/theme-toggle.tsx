"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

/**
 * Light / dark / system toggle.
 *
 * Writes `data-theme` on <html>, which the CSS variables in globals.css key
 * off. "system" removes the attribute entirely rather than resolving it to a
 * concrete value, so the OS preference keeps applying when the user changes it
 * later — resolving it once would freeze the choice at whatever it was.
 *
 * Defaults to "light", not "system" (Part: full UI redesign per UI.md,
 * 2026-10-23 — reverses the previous dark-default fix now that the design
 * language itself has flipped; see app/layout.tsx's THEME_INIT_SCRIPT for
 * the full reasoning, which this must stay in sync with). "system" is
 * still a real, explicit choice available from the toggle — only the
 * *default before any choice* changed.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const stored = (window.localStorage.getItem("theme") as Theme) ?? "light";
    setTheme(stored);
    apply(stored);
  }, []);

  function apply(next: Theme) {
    const root = document.documentElement;
    if (next === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", next);
  }

  function cycle() {
    const next: Theme = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
    setTheme(next);
    window.localStorage.setItem("theme", next);
    apply(next);
  }

  const icon = theme === "light" ? "☀" : theme === "dark" ? "☾" : "◐";

  return (
    <button
      type="button"
      onClick={cycle}
      // The label names the current state, so a screen reader user isn't left
      // guessing what a symbol means.
      aria-label={`Theme: ${theme}. Click to change.`}
      title={`Theme: ${theme}`}
      // 48x48 white icon button, matching the top bar's other icon buttons
      // (Part: full UI redesign per UI.md, Section 6.1) — fixed white
      // rather than text-ink since this sits on --accent in both themes.
      className="flex h-12 w-12 items-center justify-center rounded text-base text-white transition-colors hover:bg-white/15"
    >
      <span aria-hidden>{icon}</span>
    </button>
  );
}
