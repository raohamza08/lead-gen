"use client";

import { useState } from "react";
import { FILTER_TAXONOMY, FilterTaxonomyKey } from "@leadgen/types";

/**
 * Inputs for the lead-targeting filter builder.
 *
 * The option lists are read straight from the shared taxonomy rather than
 * duplicated here, so the UI can never offer a value the API would reject.
 */

/**
 * Multi-select over one taxonomy catalogue.
 *
 * Each option carries a `why` line explaining what it predicts. That text is
 * shown rather than hidden behind a tooltip: these filters change which
 * companies get contacted, and a user picking blind is the main way a targeting
 * config ends up quietly wrong.
 */
export function TaxonomyMultiSelect({
  taxonomyKey,
  label,
  hint,
  selected,
  onChange,
}: {
  taxonomyKey: FilterTaxonomyKey;
  label: string;
  hint?: string;
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const options = FILTER_TAXONOMY[taxonomyKey];

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  return (
    <fieldset className="rounded-lg border border-[var(--line)] p-4">
      <legend className="px-1 text-xs font-medium uppercase tracking-wide text-ink/60">
        {label}
        {selected.length > 0 && <span className="ml-1.5 text-accent">({selected.length})</span>}
      </legend>
      {hint ? <p className="mb-3 text-xs text-ink/50">{hint}</p> : null}

      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const isOn = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggle(opt.value)}
              aria-pressed={isOn}
              title={opt.why}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                isOn
                  ? "border-accent bg-accent/10 font-medium text-ink"
                  : "border-[var(--line)] text-ink/65 hover:bg-ink/5"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-3 text-xs text-ink/50 underline underline-offset-2 hover:text-ink/80"
      >
        {expanded ? "Hide" : "Why these matter"}
      </button>
      {expanded && (
        <dl className="mt-2 space-y-1.5 border-t border-[var(--line)] pt-2">
          {options.map((opt) => (
            <div key={opt.value} className="text-xs">
              <dt className="inline font-medium text-ink/75">{opt.label}: </dt>
              <dd className="inline text-ink/55">{opt.why}</dd>
            </div>
          ))}
        </dl>
      )}
    </fieldset>
  );
}

/**
 * Free-text list input for values no fixed catalogue can cover — company
 * keywords, industries and company names to exclude. Entries are added on Enter
 * or comma.
 */
export function TagInput({
  label,
  hint,
  placeholder,
  values,
  onChange,
}: {
  label: string;
  hint?: string;
  placeholder?: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function commit() {
    const entry = draft.trim().replace(/,$/, "");
    // Case-insensitive dedupe: "Fintech" and "fintech" would otherwise both be
    // sent and both appear as separate criteria in the prompt.
    if (entry && !values.some((v) => v.toLowerCase() === entry.toLowerCase())) {
      onChange([...values, entry]);
    }
    setDraft("");
  }

  return (
    <div className="rounded-lg border border-[var(--line)] p-4">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink/60">
        {label}
        {values.length > 0 && <span className="ml-1.5 text-accent">({values.length})</span>}
      </div>
      {hint ? <p className="mb-2 text-xs text-ink/50">{hint}</p> : null}

      {values.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span
              key={v}
              className="flex items-center gap-1 rounded-full border border-[var(--line)] px-2.5 py-1 text-xs"
            >
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                aria-label={`Remove ${v}`}
                className="text-ink/40 hover:text-bad"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        value={draft}
        placeholder={placeholder}
        onChange={(e) => {
          // Typing a comma commits the entry, so pasted comma-separated lists
          // behave the way people expect.
          if (e.target.value.endsWith(",")) {
            setDraft(e.target.value);
            commit();
          } else {
            setDraft(e.target.value);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            // Otherwise Enter submits the surrounding form instead of adding
            // the tag the user just typed.
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
        className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
      />
    </div>
  );
}

/** Optional numeric range. Empty means "no constraint on this dimension". */
export function RangeInput({
  label,
  unit,
  min,
  max,
  onChange,
}: {
  label: string;
  unit?: string;
  min: number | null;
  max: number | null;
  onChange: (min: number | null, max: number | null) => void;
}) {
  // "" -> null, not 0. Treating a cleared box as 0 would silently apply a real
  // lower bound the user never asked for.
  const parse = (v: string) => (v === "" ? null : Number(v));

  return (
    <div className="rounded-lg border border-[var(--line)] p-4">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/60">{label}</div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={min ?? ""}
          placeholder="Any"
          onChange={(e) => onChange(parse(e.target.value), max)}
          className="w-24 rounded border border-[var(--line)] bg-transparent px-2 py-1.5 text-sm"
        />
        <span className="text-xs text-ink/40">to</span>
        <input
          type="number"
          value={max ?? ""}
          placeholder="Any"
          onChange={(e) => onChange(min, parse(e.target.value))}
          className="w-24 rounded border border-[var(--line)] bg-transparent px-2 py-1.5 text-sm"
        />
        {unit ? <span className="text-xs text-ink/50">{unit}</span> : null}
      </div>
    </div>
  );
}
