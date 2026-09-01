import type { ReactNode, ThHTMLAttributes } from "react";

/**
 * Shared table primitives (Part: UI/UX Redesign, 2026-09-01) — generalizes
 * the table markup pattern already used in app/(dashboard)/leads/page.tsx
 * into reusable pieces, rather than inventing a new table library. Plain
 * semantic `<table>` underneath — no Radix table primitive exists, and none
 * is needed since a table has no focus-trap/keyboard-nav complexity a
 * checkbox/select/dialog does.
 */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return <thead>{children}</thead>;
}

export function TableHeadRow({ children }: { children: ReactNode }) {
  return <tr className="border-b border-[var(--line)] text-left text-xs text-ink/55">{children}</tr>;
}

interface SortableTh extends ThHTMLAttributes<HTMLTableCellElement> {
  sortDirection?: "asc" | "desc" | null;
  onSort?: () => void;
}

export function Th({ children, sortDirection, onSort, className = "", ...props }: SortableTh) {
  if (!onSort) {
    return (
      <th className={`px-3 py-2 font-medium ${className}`} {...props}>
        {children}
      </th>
    );
  }
  return (
    <th className={`px-3 py-2 font-medium ${className}`} {...props}>
      <button type="button" onClick={onSort} className="flex items-center gap-1 transition-colors duration-fast hover:text-ink">
        {children}
        {sortDirection && (
          <span aria-hidden className="text-[10px]">
            {sortDirection === "asc" ? "▲" : "▼"}
          </span>
        )}
      </button>
    </th>
  );
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function Tr({
  children,
  onClick,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <tr
      onClick={onClick}
      className={`border-b border-[var(--line)] transition-colors duration-fast last:border-0 ${onClick ? "cursor-pointer hover:bg-ink/5" : ""} ${className}`}
    >
      {children}
    </tr>
  );
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}

export function TableEmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center text-sm text-ink/50">
        {children}
      </td>
    </tr>
  );
}
