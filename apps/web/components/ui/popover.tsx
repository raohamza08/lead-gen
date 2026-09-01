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

export function PopoverContent({
  children,
  align = "end",
  sideOffset = 8,
  className = "",
}: {
  children: ReactNode;
  align?: "start" | "center" | "end";
  sideOffset?: number;
  className?: string;
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={`dropdown-content z-50 rounded-[var(--radius)] border border-[var(--line)] bg-surface shadow-lg ${className}`}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
