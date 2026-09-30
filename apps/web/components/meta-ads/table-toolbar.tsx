"use client";

import { ReactNode } from "react";

export interface SortOption {
  value: string;
  label: string;
}

/** Search + sort controls shared by the Campaigns/Ad Sets/Ads tables (Part:
 *  Meta Ads module — "make tables sortable, searchable, filterable, and
 *  paginated"). Status filtering and any entity-specific filter (e.g.
 *  "Campaign" on the Ad Sets table) are passed in as `extraFilters` since
 *  their options differ per table. */
export function MetaAdsTableToolbar({
  search,
  onSearchChange,
  sortBy,
  onSortByChange,
  sortDir,
  onSortDirChange,
  sortOptions,
  extraFilters,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  sortBy: string;
  onSortByChange: (v: string) => void;
  sortDir: "asc" | "desc";
  onSortDirChange: (v: "asc" | "desc") => void;
  sortOptions: SortOption[];
  extraFilters?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search by name…"
        className="w-48 rounded-md border border-[var(--line)] bg-transparent px-2.5 py-1.5 text-sm"
      />
      {extraFilters}
      <select
        value={sortBy}
        onChange={(e) => onSortByChange(e.target.value)}
        className="rounded-md border border-[var(--line)] bg-transparent px-2 py-1.5 text-xs"
      >
        {sortOptions.map((o) => (
          <option key={o.value} value={o.value}>
            Sort: {o.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onSortDirChange(sortDir === "asc" ? "desc" : "asc")}
        className="rounded-md border border-[var(--line)] px-2 py-1.5 text-xs text-ink/65 hover:bg-ink/5"
        title="Toggle sort direction"
      >
        {sortDir === "asc" ? "↑ Asc" : "↓ Desc"}
      </button>
    </div>
  );
}

export function MetaAdsPagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between text-xs text-ink/55">
      <span>
        {total === 0 ? "0 results" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
      </span>
      <div className="flex gap-1">
        <button
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="rounded-md border border-[var(--line)] px-2 py-1 disabled:opacity-40"
        >
          Prev
        </button>
        <span className="px-1 py-1">
          {page} / {totalPages}
        </span>
        <button
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="rounded-md border border-[var(--line)] px-2 py-1 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
