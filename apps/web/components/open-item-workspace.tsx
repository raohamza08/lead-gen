"use client";

import { ReactNode } from "react";

/**
 * Inline compose/form + open-item tab strip primitives (Part: full UI
 * redesign per UI.md, 2026-10-23, Section 6.7) — "new items open inline
 * inside the detail pane as a form, not a modal dialog, and multiple open
 * items... stack as tabs at the very bottom of the window." Provided as
 * ready-to-adopt building blocks rather than forced onto an existing flow:
 * no page in this app currently has a genuine "several records open for
 * editing at once" need (every existing "new X" action is a single modal
 * dialog — Leads, Upwork proposals, social posts, etc.), and inventing a
 * multi-document-open UI for a creation flow that only ever has one thing
 * open at a time would be new product behavior, not a visual restyle. Use
 * these when building/retrofitting a flow that genuinely benefits from
 * staying open across multiple records (e.g. a future multi-draft
 * Proposal Writing session).
 */

/** One underline-only field, spec's own recipe: "borderless, underline-only
 *  inputs with a small pill-style label... light-gray placeholder." */
export function InlineField({
  label,
  value,
  onChange,
  placeholder,
  large = false,
  rows,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Subject/title field — spec: "large, borderless, underline-only on focus." */
  large?: boolean;
  /** Renders a textarea instead of an input when set. */
  rows?: number;
}) {
  const base = "w-full border-0 border-b border-transparent bg-transparent px-1 py-1.5 outline-none focus:border-accent";
  return (
    <label className="flex items-center gap-2 border-b border-[var(--line)] py-1">
      <span className="shrink-0 rounded-full bg-ink/[0.06] px-2 py-0.5 text-xs text-ink-muted">{label}</span>
      {rows ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          className={`${base} resize-none text-sm text-ink placeholder:text-ink-muted`}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${base} ${large ? "text-base" : "text-sm"} text-ink placeholder:text-ink-muted`}
        />
      )}
    </label>
  );
}

/** The spec's Send/Save split-button: solid blue, 4px radius, 31px tall,
 *  disabled state turns fully neutral gray (bg AND text, not just
 *  opacity) — Section 6.7/6.3. `onMore` renders the attached chevron
 *  segment as a separate click target when provided. */
export function SplitPrimaryButton({
  label,
  onClick,
  onMore,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  onMore?: () => void;
  disabled?: boolean;
}) {
  const stateClasses = disabled ? "bg-[var(--rail-bg)] text-[#BDBDBD] cursor-not-allowed" : "bg-accent text-white hover:opacity-90";
  return (
    <span className="inline-flex h-[31px]">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`flex items-center rounded-l px-3 text-sm font-semibold transition-colors ${stateClasses} ${onMore ? "" : "rounded-r"}`}
      >
        {label}
      </button>
      {onMore && (
        <button
          type="button"
          onClick={onMore}
          disabled={disabled}
          aria-label={`More ${label.toLowerCase()} options`}
          className={`flex items-center rounded-r border-l border-black/10 px-1.5 transition-colors ${stateClasses}`}
        >
          <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 3.5 5 6.5 8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </span>
  );
}

export interface OpenItem {
  id: string;
  title: string;
  icon?: ReactNode;
}

/** Bottom tab strip for multiple open records (Section 6.7) — fixed to the
 *  bottom of the window, lets the user flip between open items without
 *  losing the list's scroll position. Renders nothing when zero/one item
 *  is open, matching the spec's "appears only when 1+ records are open"
 *  framing for the analogous ribbon case (Section 2). */
export function OpenItemTabStrip({
  items,
  activeId,
  onSelect,
  onClose,
}: {
  items: OpenItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex h-9 shrink-0 items-stretch gap-0.5 overflow-x-auto border-t border-[var(--line)] bg-surface px-1.5">
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <div
            key={item.id}
            onClick={() => onSelect(item.id)}
            role="tab"
            aria-selected={active}
            className={`flex max-w-[180px] shrink-0 cursor-pointer items-center gap-1.5 rounded-t px-2.5 text-xs transition-colors ${
              active ? "bg-accent/10 font-semibold text-ink" : "text-ink/60 hover:bg-ink/5"
            }`}
          >
            {item.icon}
            <span className="truncate">{item.title}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose(item.id);
              }}
              aria-label={`Close ${item.title}`}
              className="shrink-0 rounded-full px-1 text-ink/40 hover:bg-ink/10 hover:text-ink"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
