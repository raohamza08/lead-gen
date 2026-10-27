"use client";

import { Input } from "./input";

/**
 * Shared "filter by date" control (Part: table filter/KPI rollout,
 * 2026-10-27, explicit user request — "add option to filter anything by
 * date in each table") — a plain From/To pair of native date inputs plus a
 * Clear button that only shows once a filter is actually set. Pairs with
 * `useDateFilter`, which does the actual row filtering; this component is
 * just the control.
 */
export function DateRangeFilter({
  from,
  to,
  onFromChange,
  onToChange,
  onClear,
  className = "",
}: {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onClear: () => void;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <Input type="date" value={from} onChange={(e) => onFromChange(e.target.value)} className="w-[9.5rem] text-xs" aria-label="From date" />
      <span className="text-xs text-ink/40">to</span>
      <Input type="date" value={to} onChange={(e) => onToChange(e.target.value)} className="w-[9.5rem] text-xs" aria-label="To date" />
      {(from || to) && (
        <button type="button" onClick={onClear} className="text-xs text-ink/50 underline-offset-2 hover:underline">
          Clear
        </button>
      )}
    </div>
  );
}
