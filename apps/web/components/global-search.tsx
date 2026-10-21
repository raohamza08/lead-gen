"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Popover, PopoverAnchor, PopoverContent } from "./ui/popover";
import { api } from "../lib/api-client";

interface SearchHit {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

/**
 * Real global search (Part: EBOS-inspired shell redesign round 2,
 * 2026-10-21) — a separate component, not inline in layout.tsx, because
 * `useQuery` must run inside a descendant of the `QueryProvider` the layout
 * itself renders, not in the layout component's own body (same reason
 * HeaderUserMenu/NotificationsBell are their own components). Fans out to
 * leads/email/social/upwork via GET /search, each gated server-side by the
 * user's own existing module-access flags.
 */
export function GlobalSearch() {
  // Same 300ms-debounce convention as leads/page.tsx's own search box, the
  // only other debounced input in this codebase.
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);
  // Explicit dismiss (Esc/outside-click/clicking a result) so the popover
  // doesn't immediately reopen on its own next render while the same query
  // is still sitting in the box.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => setDismissed(false), [debouncedSearch]);

  const searchQuery = useQuery({
    queryKey: ["global-search", debouncedSearch],
    queryFn: () => api.globalSearch(debouncedSearch) as Promise<Record<"leads" | "emails" | "social" | "upwork", SearchHit[]>>,
    enabled: debouncedSearch.length >= 2,
  });
  const open = !dismissed && debouncedSearch.length >= 2;
  const results = searchQuery.data;
  const hasAnyResults = Boolean(
    results && (results.leads.length || results.emails.length || results.social.length || results.upwork.length),
  );

  function close() {
    setDismissed(true);
  }

  function renderGroup(label: string, items: SearchHit[]) {
    if (!items.length) return null;
    return (
      <div key={label}>
        <div className="px-2 py-1 text-label uppercase text-ink/45">{label}</div>
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            onClick={close}
            className="flex flex-col rounded-lg px-2.5 py-1.5 text-sm text-ink/80 transition-colors duration-fast hover:bg-ink/5"
          >
            <span className="truncate">{item.title}</span>
            {item.subtitle && <span className="truncate text-xs text-ink/45">{item.subtitle}</span>}
          </Link>
        ))}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={(o) => !o && close()}>
      <PopoverAnchor asChild>
        <label className="glass-surface flex w-full max-w-md items-center gap-2 rounded-full border border-[var(--line)] px-3.5 py-2 text-ink/45">
          <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" className="shrink-0">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search..."
            className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink/40 focus:outline-none"
          />
          <kbd className="shrink-0 rounded border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-ink/40">Ctrl K</kbd>
        </label>
      </PopoverAnchor>
      <PopoverContent align="center" className="max-h-[70vh] w-[420px] overflow-y-auto p-2" onOpenAutoFocus={(e) => e.preventDefault()}>
        {searchQuery.isFetching && <div className="px-2.5 py-2 text-xs text-ink/45">Searching…</div>}
        {!searchQuery.isFetching && !hasAnyResults && <div className="px-2.5 py-2 text-xs text-ink/45">No results.</div>}
        {results && (
          <div className="flex flex-col gap-2">
            {renderGroup("Leads", results.leads)}
            {renderGroup("Email", results.emails)}
            {renderGroup("Social", results.social)}
            {renderGroup("Upwork", results.upwork)}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
