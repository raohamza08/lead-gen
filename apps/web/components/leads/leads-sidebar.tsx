"use client";

/**
 * Pipeline's own "Leads" second-level sidebar (Part: full UI redesign per
 * UI.md, explicit user request — a Lightshot screenshot of the Pipeline
 * page rebuilt in the spec's Views/Folder Pane pattern, Section 6.4:
 * collapsible Favourites section, then grouped view lists, each with a
 * live count badge, selected item in flat --selected-bg gray).
 *
 * Every count here is computed from real lead data already on the page —
 * no fabricated views. The reference screenshot also showed "Pipelines >
 * Other Pipelines" and flat "Tasks / Trash / Archive" entries; those are
 * deliberately NOT included because none of them have anything real
 * behind them in this app: there is exactly one pipeline (no multi-
 * pipeline concept exists), and Lead has no task/archive/soft-delete
 * field anywhere in the schema (deletes are real, permanent, and already
 * surfaced via the page's own "Delete all" control, not a trash). Adding
 * those would be decorative chrome pretending to be real functionality,
 * which this app avoids everywhere else.
 */
export type LeadsSidebarFilter = "my" | "hot" | "today" | "unassigned" | "recent" | null;

function GridIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.2" />
    </svg>
  );
}
function UserIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" strokeLinecap="round" />
    </svg>
  );
}
function FireIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path
        d="M12 3c1 3-3 4-3 7a3 3 0 0 0 6 0c1 1 1.5 2.3 1.5 3.5A4.5 4.5 0 0 1 12 18a4.5 4.5 0 0 1-4.5-4.5C7.5 9 12 7 12 3Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function ClockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function LayersIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path d="M12 3.5 3.5 8 12 12.5 20.5 8z" strokeLinejoin="round" />
      <path d="M3.5 12 12 16.5 20.5 12M3.5 16l8.5 4.5L20.5 16" strokeLinejoin="round" />
    </svg>
  );
}
function QuestionIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7" strokeLinecap="round" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" />
    </svg>
  );
}

function Row({
  label,
  count,
  icon,
  active,
  onClick,
  indent = false,
}: {
  label: string;
  count: number;
  icon?: React.ReactNode;
  active: boolean;
  onClick: () => void;
  indent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${indent ? "ml-1" : ""} ${
        active ? "bg-[var(--selected-bg)] font-semibold text-ink" : "text-ink/65 hover:bg-ink/5"
      }`}
    >
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      {count > 0 && <span className="tabular rounded-full bg-ink/8 px-1.5 py-0.5 text-[10px] font-semibold text-accent">{count}</span>}
    </button>
  );
}

export function LeadsSidebar({
  counts,
  filter,
  onFilterChange,
}: {
  counts: { my: number; all: number; hot: number; today: number; unassigned: number; recent: number };
  filter: LeadsSidebarFilter;
  onFilterChange: (f: LeadsSidebarFilter) => void;
}) {
  return (
    <div className="hidden w-[214px] shrink-0 flex-col gap-3 border-r border-[var(--line)] py-3 pr-3 lg:flex">
      <div>
        <h2 className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Favourites</h2>
        <div className="flex flex-col gap-0.5">
          <Row label="My leads" count={counts.my} icon={<UserIcon className="h-4 w-4" />} active={filter === "my"} onClick={() => onFilterChange(filter === "my" ? null : "my")} />
          <Row label="All leads" count={counts.all} icon={<GridIcon className="h-4 w-4" />} active={filter === null} onClick={() => onFilterChange(null)} />
          <Row label="Hot leads" count={counts.hot} icon={<FireIcon className="h-4 w-4" />} active={filter === "hot"} onClick={() => onFilterChange(filter === "hot" ? null : "hot")} />
          <Row
            label="Today's activity"
            count={counts.today}
            icon={<ClockIcon className="h-4 w-4" />}
            active={filter === "today"}
            onClick={() => onFilterChange(filter === "today" ? null : "today")}
          />
        </div>
      </div>

      <div>
        <h2 className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Pipelines</h2>
        <div className="flex flex-col gap-0.5">
          <Row label="Pipeline" count={counts.all} icon={<LayersIcon className="h-4 w-4" />} active={filter === null} onClick={() => onFilterChange(null)} />
        </div>
      </div>

      <div>
        <h2 className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Views</h2>
        <div className="flex flex-col gap-0.5">
          <Row
            label="Unassigned"
            count={counts.unassigned}
            icon={<QuestionIcon className="h-4 w-4" />}
            active={filter === "unassigned"}
            onClick={() => onFilterChange(filter === "unassigned" ? null : "unassigned")}
          />
          <Row
            label="Recently added"
            count={counts.recent}
            icon={<ClockIcon className="h-4 w-4" />}
            active={filter === "recent"}
            onClick={() => onFilterChange(filter === "recent" ? null : "recent")}
          />
        </div>
      </div>
    </div>
  );
}
