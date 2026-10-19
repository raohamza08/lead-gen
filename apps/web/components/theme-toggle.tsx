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
 * Defaults to "dark", not "system" (Part: premium dark theme pass v4 fix,
 * 2026-10-19) — matches app/layout.tsx's THEME_INIT_SCRIPT, which now does
 * the same for the same reason: "system" meant a default-light browser saw
 * the old untouched light theme and none of this app's actual dark-mode
 * design work. Must stay in sync with that script's fallback, or this
 * effect would overwrite the init script's dark default back to "system"
 * (and therefore back to light, for most visitors) on every page load.
 * "system" is still a real, explicit choice available from the toggle —
 * only the *default before any choice* changed.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const stored = (window.localStorage.getItem("theme") as Theme) ?? "dark";
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
      className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5"
    >
      <span aria-hidden>{icon}</span>
    </button>
  );
}
