"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";

/**
 * Org-wide accent-color override (Part: Dashboard Center, 2026-10-20 —
 * corrected after the user clarified the original request: "the color
 * option... is the color that when i change, it will be changed on
 * everyone's end". The first pass stored the choice in localStorage, which
 * only ever affected the one browser that set it — not what was asked.
 *
 * Two independent things, not one:
 * 1. WHO CAN CHANGE IT — gated to the org's primary admin only (the same
 *    exactly-one-person flag sidebar-nav.tsx already gates "System Logs"
 *    behind), enforced server-side by PrimaryAdminGuard on the PATCH/DELETE
 *    routes, not just hidden client-side.
 * 2. WHO SEES THE RESULT — every logged-in user. `colorQuery` below runs
 *    unconditionally (not gated on isPrimaryAdmin) so the override applies
 *    for everyone; only the swatch BUTTON that opens the picker is hidden
 *    from non-primary-admins, via the early `return null`.
 */
const SWATCHES = [
  "#0F6CBD", // this app's default accent (UI.md Outlook spec), same in both themes
  "#e0392a",
  "#eda100",
  "#1baf7a",
  "#2a78d6",
  "#8b5cf6",
  "#d6336c",
  "#0e6e6b",
];

function hexToRgbTriplet(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** WCAG-ish relative luminance, just enough to pick black-vs-white text that
 *  stays legible on a solid fill of this color — the same problem the
 *  dark-mode theme pass already solved once for the built-in accent. */
function contrastTripletFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "255 255 255";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.45 ? "20 16 13" : "255 255 255";
}

/** --accent-2-rgb is set EQUAL to --accent-rgb, not lightened (Part: full
 *  UI redesign per UI.md, 2026-10-23) — the spec's own --btn-primary-bg
 *  is a flat fill (no gradient anywhere in the design), so a two-tone
 *  override here would reintroduce the two-tone button look the redesign
 *  removed, even though the admin only picked one color. `lighten` is
 *  kept defined (still a real, reasonable utility) but unused by this
 *  call now. */
/** Also caches to localStorage (Part: accent FOUC fix, 2026-10-23) — the
 *  authoritative value lives server-side, so there's no way to read it
 *  synchronously before first paint on the next load. app/layout.tsx's
 *  THEME_INIT_SCRIPT reads this same key to apply it before React even
 *  mounts; this effect then confirms/corrects it a moment later once the
 *  real fetch resolves, same as it always did. */
function applyAccent(hex: string | null) {
  const root = document.documentElement.style;
  try {
    if (hex) localStorage.setItem("org-accent-color", hex);
    else localStorage.removeItem("org-accent-color");
  } catch {
    // localStorage can throw in some privacy modes — the CSS override below
    // still applies for this load, it just won't survive a reload.
  }
  if (!hex) {
    root.removeProperty("--accent-rgb");
    root.removeProperty("--accent-2-rgb");
    root.removeProperty("--accent-contrast-rgb");
    return;
  }
  const base = hexToRgbTriplet(hex);
  if (!base) return;
  root.setProperty("--accent-rgb", base);
  root.setProperty("--accent-2-rgb", base);
  root.setProperty("--accent-contrast-rgb", contrastTripletFor(hex));
}

export function AccentPicker() {
  const queryClient = useQueryClient();
  const meQuery = useQuery({
    queryKey: ["me-accent-gate"],
    queryFn: () => api.getMe() as Promise<{ isPrimaryAdmin: boolean }>,
    staleTime: Infinity,
  });
  // Runs for every user regardless of role — this is what makes the color
  // actually org-wide rather than a personal preference.
  const colorQuery = useQuery({
    queryKey: ["org-accent-color"],
    queryFn: () => api.getOrgAccentColor() as Promise<{ hex: string | null }>,
    staleTime: 60_000,
  });
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    applyAccent(colorQuery.data?.hex ?? null);
  }, [colorQuery.data?.hex]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const setMutation = useMutation({
    mutationFn: (hex: string) => api.updateOrgAccentColor(hex) as Promise<{ hex: string | null }>,
    onSuccess: (result) => queryClient.setQueryData(["org-accent-color"], result),
  });
  const resetMutation = useMutation({
    mutationFn: () => api.resetOrgAccentColor() as Promise<{ hex: string | null }>,
    onSuccess: (result) => queryClient.setQueryData(["org-accent-color"], result),
  });

  if (!meQuery.data?.isPrimaryAdmin) return null;

  const hex = colorQuery.data?.hex ?? null;

  return (
    <div ref={panelRef} className="relative">
      {/* 48x48 white icon button matching the top bar's other icon buttons
          (Part: full UI redesign per UI.md, Section 6.1) — fixed white
          rather than text-ink since this sits on --accent in both themes. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Change accent color for everyone (only you can do this)"
        title="Accent color — applies org-wide, only you can change it"
        className="flex h-12 w-12 items-center justify-center rounded text-white transition-colors hover:bg-white/15"
      >
        <span aria-hidden className="h-3.5 w-3.5 rounded-full ring-1 ring-white/70" style={{ background: hex ?? "#ffffff" }} />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-56 rounded-lg border border-[var(--line)] bg-surface p-3 shadow-lg">
          <p className="mb-2 text-[11px] text-ink/50">Changes the accent for everyone in the org. Only you can see this control.</p>
          <div className="grid grid-cols-8 gap-1.5">
            {SWATCHES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setMutation.mutate(s)}
                aria-label={s}
                className={`h-5 w-5 rounded-full border transition-transform hover:scale-110 ${hex === s ? "ring-2 ring-offset-1 ring-offset-surface ring-[var(--accent)]" : "border-[var(--line)]"}`}
                style={{ background: s }}
              />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              type="color"
              value={hex ?? "#0F6CBD"}
              onChange={(e) => setMutation.mutate(e.target.value)}
              className="h-7 w-7 cursor-pointer rounded border border-[var(--line)] bg-transparent p-0"
            />
            <span className="text-xs text-ink/60">Custom</span>
            {hex && (
              <button type="button" onClick={() => resetMutation.mutate()} className="ml-auto text-xs text-accent hover:underline">
                Reset
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
