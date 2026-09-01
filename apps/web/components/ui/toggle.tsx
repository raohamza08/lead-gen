"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";

/** Shared boolean toggle (Part: UI/UX Redesign, 2026-09-01) — for settings
 *  switches (audited/converted from checkbox-as-toggle patterns during the
 *  module redesign phases, not introduced here). The thumb's movement is a
 *  transform, not a left/right position change, so it stays GPU-cheap. */
export function Toggle({
  checked,
  onCheckedChange,
  label,
  id,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
  id?: string;
}) {
  const control = (
    <SwitchPrimitive.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      className="relative h-5 w-9 shrink-0 rounded-full bg-ink/15 transition-colors duration-fast data-[state=checked]:bg-primary
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
    >
      <SwitchPrimitive.Thumb className="block h-3.5 w-3.5 translate-x-1 rounded-full bg-white shadow-sm transition-transform duration-fast will-change-transform data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  );

  if (!label) return control;
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-3 text-sm text-ink/80">
      {label}
      {control}
    </label>
  );
}
