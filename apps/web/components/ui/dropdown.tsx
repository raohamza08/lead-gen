"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";

/**
 * Thin styled wrapper over Radix's DropdownMenu (Part: UI/UX Redesign,
 * 2026-09-01) — first consumer is HeaderUserMenu. Radix owns focus trapping,
 * keyboard nav (arrow keys/Home/End/typeahead), and `role`/`aria-*` wiring;
 * this file only owns visual styling so every future dropdown in the app
 * (there is currently exactly one hand-rolled equivalent, the notification
 * panel — migrated separately in a later phase) looks and animates the same
 * way. Re-exports the primitive's own compound-component shape rather than
 * inventing a different API, so callers already familiar with Radix's docs
 * need nothing new.
 */
export const Dropdown = DropdownMenuPrimitive.Root;
export const DropdownTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownContent({
  children,
  align = "end",
  sideOffset = 8,
}: {
  children: ReactNode;
  align?: "start" | "center" | "end";
  sideOffset?: number;
}) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className="dropdown-content z-50 min-w-[10rem] overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-surface p-1 shadow-lg"
      >
        {children}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownItem({
  children,
  onSelect,
  destructive = false,
}: {
  children: ReactNode;
  onSelect?: () => void;
  destructive?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.Item
      onSelect={onSelect}
      className={`flex cursor-pointer select-none items-center rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors duration-fast
        data-[highlighted]:bg-ink/5 ${destructive ? "text-error" : "text-ink/80"}`}
    >
      {children}
    </DropdownMenuPrimitive.Item>
  );
}

export function DropdownSeparator() {
  return <DropdownMenuPrimitive.Separator className="my-1 h-px bg-[var(--line)]" />;
}
