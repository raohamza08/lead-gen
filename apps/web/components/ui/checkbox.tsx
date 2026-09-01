"use client";

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import type { ReactNode } from "react";

/** Shared checkbox (Part: UI/UX Redesign, 2026-09-01) — replaces raw
 *  `<input type="checkbox">` in compose-modal.tsx and Email Hub's bulk
 *  select-all/select-one checkboxes. Radix owns the indeterminate visual
 *  state and keyboard/focus handling; this file only styles it. */
export function Checkbox({
  checked,
  onCheckedChange,
  label,
  id,
}: {
  checked: boolean | "indeterminate";
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  id?: string;
}) {
  const box = (
    <CheckboxPrimitive.Root
      id={id}
      checked={checked}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-[var(--line)] bg-transparent transition-colors duration-fast
        data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
    >
      <CheckboxPrimitive.Indicator className="text-white">
        {checked === "indeterminate" ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <rect x="1" y="4.25" width="8" height="1.5" fill="currentColor" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M1.5 5.2 4 7.7 8.5 2.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );

  if (!label) return box;
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-sm text-ink/80">
      {box}
      {label}
    </label>
  );
}
