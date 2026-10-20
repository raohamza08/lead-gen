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
  "#f2754a", // this app's current default dark-mode accent
  "#e0392a",
  "#eda100",
  "#1baf7a",
  "#2a78d6",
  "#8b5cf6",
  "#d6336c",
  "#0e6e6b", // this app's current default light-mode accent
];

function hexToRgbTriplet(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

function lighten(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) + (255 - ((n >> 16) & 255)) * amount);
  const g = Math.round(((n >> 8) & 255) + (255 - ((n >> 8) & 255)) * amount);
  const b = Math.round((n & 255) + (255 - (n & 255)) * amount);
  return `${r} ${g} ${b}`;
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

function applyAccent(hex: string | null) {
  const root = document.documentElement.style;
  if (!hex) {
    root.removeProperty("--accent-rgb");
    root.removeProperty("--accent-2-rgb");
    root.removeProperty("--accent-contrast-rgb");
    return;
  }
  const base = hexToRgbTriplet(hex);
  if (!base) return;
  root.setProperty("--accent-rgb", base);
  root.setProperty("--accent-2-rgb", lighten(hex, 0.3));
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
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Change accent color for everyone (only you can do this)"
        title="Accent color — applies org-wide, only you can change it"
        className="flex h-[30px] w-[30px] items-center justify-center rounded-md border border-[var(--line)] transition-colors hover:bg-ink/5"
      >
        <span aria-hidden className="h-3.5 w-3.5 rounded-full" style={{ background: hex ?? "var(--accent)" }} />
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
              value={hex ?? "#f2754a"}
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
