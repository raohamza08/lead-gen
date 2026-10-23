"use client";

import { ReactNode } from "react";

/**
 * Reusable Record List + Detail Panel primitives (Part: full UI redesign
 * per UI.md, 2026-10-23, Section 6.5/6.6) — the spec's one most-reused
 * pattern across this app's modules (Leads, Email Hub, Rooms & Messages,
 * Delayed Responses, Marketplace Jobs, Invites, Proposal Writing drafts,
 * etc. all boil down to "a list of records on the left, the selected
 * one's detail on the right"). Intentionally thin: callers own their own
 * search/filter header and data fetching, these just give every module
 * the exact same row/selection/hover/detail-header visual language
 * instead of each one hand-rolling its own slightly-different version.
 */

/** A list row (Section 6.5) — avatar, primary/secondary/tertiary text,
 *  timestamp, unread/selection states, hover-reveal actions. Height isn't
 *  fixed (the spec's own "~81px" is for its default 3-line content); a
 *  `footer` slot (badges, tags) is allowed to grow it, same as several of
 *  this app's existing hand-rolled list rows already do. */
export function RecordRow({
  avatar,
  primary,
  secondary,
  secondaryUnread = false,
  tertiary,
  timestamp,
  timestampUnread = false,
  unread = false,
  selected = false,
  onClick,
  hoverActions,
  footer,
}: {
  avatar: ReactNode;
  primary: string;
  secondary?: string;
  secondaryUnread?: boolean;
  tertiary?: string;
  timestamp?: string;
  timestampUnread?: boolean;
  unread?: boolean;
  selected?: boolean;
  onClick?: () => void;
  hoverActions?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="option"
      aria-selected={selected}
      className={`group relative flex w-full items-start gap-3 border-b border-[var(--line)] px-3 py-3 text-left transition-colors ${
        selected ? "outline outline-1 outline-accent -outline-offset-1" : ""
      } hover:bg-ink/[0.03]`}
    >
      {/* "Needs attention" = 3px solid blue left-edge bar (Section 4/8). */}
      {unread && <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[3px] bg-accent" />}

      {avatar}

      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-ink">{primary}</span>
          {timestamp && (
            <span className={`shrink-0 text-[12px] font-semibold ${timestampUnread ? "text-accent" : "text-ink-muted"}`}>{timestamp}</span>
          )}
        </span>
        {secondary && (
          <span className={`mt-0.5 block truncate text-sm font-semibold ${secondaryUnread ? "text-accent" : "text-ink"}`}>{secondary}</span>
        )}
        {tertiary && <span className="mt-0.5 block truncate text-sm text-ink-muted">{tertiary}</span>}
        {footer && <span className="mt-1.5 block">{footer}</span>}
      </span>

      {/* Hover-reveal secondary actions (Section 6.5/8 rule 3) — invisible
          until hovered, keeping the resting row clean. */}
      {hoverActions && (
        <span
          onClick={(e) => e.stopPropagation()}
          className="absolute right-3 top-3 hidden items-center gap-1 rounded bg-surface px-1 group-hover:flex"
        >
          {hoverActions}
        </span>
      )}
    </button>
  );
}

/** Scrollable list container + header (Section 6.5) — title at ~16-18px
 *  bold, optional star/favorite icon, an actions slot (search box, filter
 *  icons) below it, then the scrollable `listbox` of rows. */
export function RecordListPanel({
  title,
  count,
  actions,
  children,
}: {
  title: string;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-2.5">
        <h2 className="text-base font-semibold text-ink">
          {title}
          {typeof count === "number" && <span className="ml-1.5 text-sm font-normal text-ink-muted">({count})</span>}
        </h2>
      </div>
      {actions && <div className="shrink-0 border-b border-[var(--line)] px-3 py-2">{actions}</div>}
      <div role="listbox" className="min-h-0 flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

/** Detail panel header block (Section 6.6) — record title, avatar +
 *  primary-identity link, meta text, right-aligned action icons and a
 *  timestamp, then a hairline divider before the body. */
export function DetailPanelHeader({
  title,
  avatar,
  identity,
  identityHref,
  meta,
  actions,
  timestamp,
}: {
  title: string;
  avatar?: ReactNode;
  identity?: string;
  identityHref?: string;
  meta?: string;
  actions?: ReactNode;
  timestamp?: string;
}) {
  return (
    <div className="border-b border-[var(--line)] pb-3">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {(avatar || identity) && (
        <div className="mt-2 flex items-center gap-2.5">
          {avatar}
          <div className="min-w-0 flex-1">
            {identity &&
              (identityHref ? (
                <a href={identityHref} className="truncate text-[16px] text-info hover:underline">
                  {identity}
                </a>
              ) : (
                <span className="truncate text-[16px] text-ink">{identity}</span>
              ))}
            {meta && <p className="truncate text-xs text-ink-muted">{meta}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
          {timestamp && <span className="shrink-0 text-xs text-ink-muted">{timestamp}</span>}
        </div>
      )}
    </div>
  );
}
