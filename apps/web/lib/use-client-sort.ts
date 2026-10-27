import { useState } from "react";

/**
 * Click-a-column-header-to-sort for a `Th`-based table (Part: table sort
 * rollout, 2026-10-27, explicit user request — "make sure all the tables
 * are in tabular form with all the options to filter, sort etc in it").
 * Client-side, over whatever `rows` this render received — for a
 * server-paginated table that sorts only the current page, not the full
 * server-side result set (same known limitation as DataTable's own
 * `sortValue`, same reasoning: real server-side sort needs a backend query
 * param per endpoint, a separate follow-up).
 *
 * `getters` maps a stable column key to the raw comparable value for that
 * column — asc -> desc -> unsorted (back to original order) on repeated
 * clicks, nulls always sort last regardless of direction.
 */
export function useClientSort<T>(rows: T[], getters: Record<string, (row: T) => string | number | null | undefined>) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);

  const sortedRows = (() => {
    if (!sort) return rows;
    const getValue = getters[sort.key];
    if (!getValue) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = getValue(a);
      const bv = getValue(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  })();

  function toggleSort(key: string) {
    if (!getters[key]) return;
    setSort((prev) => {
      if (prev?.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  function sortDirectionFor(key: string): "asc" | "desc" | null {
    return sort?.key === key ? sort.dir : null;
  }

  return { sortedRows, toggleSort, sortDirectionFor };
}
