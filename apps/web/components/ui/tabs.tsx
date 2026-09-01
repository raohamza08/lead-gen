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
}: {
  value: string;
  onValueChange: (value: string) => void;
  tabs: { value: string; label: string; count?: number }[];
}) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange}>
      <TabsPrimitive.List className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <TabsPrimitive.Trigger
            key={t.value}
            value={t.value}
            className="rounded-full px-3 py-1.5 text-xs font-medium text-ink/65 transition-colors duration-fast
              hover:bg-ink/5 data-[state=active]:bg-primary data-[state=active]:text-white"
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
