import { useState } from "react";

/**
 * Client-side date-range filtering for a table (Part: table filter/KPI
 * rollout, 2026-10-27, explicit user request — "add option to filter
 * anything by date in each table"). Filters whatever `rows` this render
 * received down to the ones whose date falls in [from, to] — same
 * client-side-over-currently-loaded-rows approach as useClientSort, same
 * known limitation: on a server-paginated table this only filters the
 * current page, not the full server-side result set.
 *
 * `getDate` returns the row's date as an ISO string or epoch ms; rows where
 * it returns null/undefined are excluded whenever a filter is active (an
 * undated row can't match a date range). `to` is treated as inclusive
 * through the end of that calendar day.
 */
export function useDateFilter<T>(rows: T[], getDate: (row: T) => string | number | null | undefined) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filteredRows =
    !from && !to
      ? rows
      : rows.filter((row) => {
          const raw = getDate(row);
          if (raw == null) return false;
          const time = typeof raw === "number" ? raw : new Date(raw).getTime();
          if (Number.isNaN(time)) return false;
          if (from && time < new Date(from).getTime()) return false;
          if (to && time > new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1) return false;
          return true;
        });

  function clear() {
    setFrom("");
    setTo("");
  }

  return { filteredRows, from, to, setFrom, setTo, clear, active: Boolean(from || to) };
}
