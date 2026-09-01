import { Button } from "./button";

/** Shared error-state (Part: UI/UX Redesign, 2026-09-01) — replaces the
 *  inline error text pattern (e.g. app/(dashboard)/overview/page.tsx's
 *  error branch) with a consistent, retryable component. `message` is
 *  expected to already be a user-facing string (the caller's own error
 *  handling decides what's safe to show) — this component doesn't attempt
 *  to sanitize or classify errors itself. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius)] border border-[rgb(var(--bad-rgb)/0.3)] bg-[rgb(var(--bad-rgb)/0.05)] px-4 py-8 text-center">
      <p className="text-sm text-error">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
