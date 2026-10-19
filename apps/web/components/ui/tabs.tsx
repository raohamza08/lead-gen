"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";

/**
 * Shared tabs (Part: UI/UX Redesign, 2026-09-01) — replaces hand-rolled pill
 * button groups (e.g. the notification category tabs, Email Hub's account/
 * view switcher) with genuine keyboard navigation (arrow keys, Home/End)
 * from Radix, which none of the hand-rolled versions had.
 */
export function Tabs({
  value,
  onValueChange,
  tabs,
  center = false,
}: {
  value: string;
  onValueChange: (value: string) => void;
  tabs: { value: string; label: string; count?: number }[];
  /** Centers the tab row instead of the default left alignment (Part:
   *  premium dark theme pass v4, 2026-10-19, explicit user request — "the
   *  tabs in the dashboard should be center aligned"). Opt-in per caller
   *  rather than the new default, since e.g. the notification bell's
   *  category tabs sit in a narrow popover where left-aligned is correct. */
  center?: boolean;
}) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange}>
      <TabsPrimitive.List className={`flex flex-wrap gap-1.5 ${center ? "justify-center" : ""}`}>
        {tabs.map((t) => (
          <TabsPrimitive.Trigger
            key={t.value}
            value={t.value}
            // text-[rgb(var(--accent-contrast-rgb))], not text-white (Part:
            // premium dark theme pass v4 fix, 2026-10-19) — white on the
            // dark-mode coral accent measures ~3.3:1, below the 4.5:1 floor;
            // this token already resolves to near-black in dark mode (where
            // it's needed) and white in light mode (where white already
            // worked), so one class now covers both correctly instead of
            // the bare `text-white` this shipped with, which the app-wide
            // `.text-white.bg-accent` contrast fix in globals.css couldn't
            // catch (Tailwind bakes the whole `data-[state=active]:` prefix
            // into one literal class token, not a separate `text-white`
            // token that selector could match).
            className="rounded-full px-3 py-1.5 text-xs font-medium text-ink/65 transition-colors duration-fast
              hover:bg-ink/5 data-[state=active]:bg-primary data-[state=active]:text-[rgb(var(--accent-contrast-rgb))]"
          >
            {t.label}
            {typeof t.count === "number" && t.count > 0 && (
              <span className="ml-1.5 opacity-80">({t.count > 99 ? "99+" : t.count})</span>
            )}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}
