"use client";

import * as SelectPrimitive from "@radix-ui/react-select";

/**
 * Shared select (Part: UI/UX Redesign, 2026-09-01) — replaces native
 * `<select>` at the 19 call sites across the app. Beyond visual consistency,
 * this removes the need for the native-popup dark-mode workaround documented
 * in app/globals.css's `select, option` rule for every call site migrated —
 * Radix renders its own popup content, not the browser's native one, so
 * dark mode just applies normally like everywhere else in the app.
 *
 * Radix forbids an empty-string item value (throws at runtime) — unlike a
 * native `<select>`, there's no built-in way to represent "nothing selected/
 * any/all" as a real, re-selectable option. Call sites that need a clearable
 * "Any X" state must use a non-empty sentinel value (e.g. "ALL") for that
 * option and translate to/from "" at the call site's own onValueChange,
 * rather than passing value="" through to `options` directly.
 */
export function Select({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  error,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  error?: boolean;
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger
        className={`flex w-full items-center justify-between rounded-lg border bg-transparent px-3 py-2 text-sm text-ink transition-colors duration-fast
          focus:outline-none focus:ring-2 focus:ring-primary/30 ${error ? "border-[rgb(var(--bad-rgb)/0.5)]" : "border-[var(--line)]"}`}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="text-ink/50">
            <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="dropdown-content z-50 max-h-72 min-w-[8rem] overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-surface p-1 shadow-lg"
        >
          <SelectPrimitive.Viewport>
            {options.map((opt) => (
              <SelectPrimitive.Item
                key={opt.value}
                value={opt.value}
                className="flex cursor-pointer select-none items-center rounded-md px-2.5 py-1.5 text-sm text-ink/80 outline-none transition-colors duration-fast
                  data-[highlighted]:bg-ink/5 data-[state=checked]:bg-primary/10 data-[state=checked]:text-primary"
              >
                <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
