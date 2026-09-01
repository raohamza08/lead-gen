import type { ReactNode } from "react";

/** Shared empty-state (Part: UI/UX Redesign, 2026-09-01) — replaces the
 *  ~19 files that independently hand-write "No X yet"/"No X found" text
 *  with slightly different classes. `action` is optional since most empty
 *  states in this app are genuinely passive ("nothing has synced yet"), not
 *  every one needs a call-to-action. */
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      {icon && <div className="mb-1 text-ink/30">{icon}</div>}
      <p className="text-sm font-medium text-ink/70">{title}</p>
      {description && <p className="max-w-sm text-xs text-ink/45">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
