"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ReactNode } from "react";

/**
 * Thin styled wrapper over Radix's Popover (Part: UI/UX Redesign,
 * 2026-09-01) — first consumer is the notification panel, which previously
 * hand-rolled its own `absolute` positioned div plus a manual `mousedown`
 * outside-click listener. Radix owns positioning (flip/collision avoidance),
 * outside-click, and ESC-to-close; this file only styles the content.
 */
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
// Anchor (Part: global search, 2026-10-21) — positions the content without
// Trigger's click-to-toggle behavior, for a search box whose popover
// visibility is driven entirely by the query's own state (open while
// typing a long-enough query) rather than by clicking the input itself;
// Trigger would otherwise close it on every click back into the input to
// reposition the cursor.
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({
  children,
  align = "end",
  sideOffset = 8,
  className = "",
  onOpenAutoFocus,
}: {
  children: ReactNode;
  align?: "start" | "center" | "end";
  sideOffset?: number;
  className?: string;
  /** Passed straight through to Radix (Part: global search, 2026-10-21) —
   *  a search box anchored via PopoverAnchor needs `(e) => e.preventDefault()`
   *  here, otherwise Radix steals focus into the (non-focusable) results
   *  panel the instant it opens, kicking the user out of the input mid-type. */
  onOpenAutoFocus?: (event: Event) => void;
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        onOpenAutoFocus={onOpenAutoFocus}
        // glass-surface (Part: premium dark theme pass v4, 2026-10-19) — see
        // globals.css for why overlays specifically get the glass treatment.
        className={`dropdown-content glass-surface z-50 rounded-[var(--radius)] border border-[var(--line)] bg-surface shadow-lg ${className}`}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
