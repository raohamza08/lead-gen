type Tone = "success" | "warning" | "error" | "info" | "neutral" | "accent";

const TONE_CLASSES: Record<Tone, string> = {
  success: "bg-success/12 text-success",
  warning: "bg-warning/15 text-warning",
  error: "bg-error/12 text-error",
  info: "bg-info/12 text-info",
  neutral: "bg-ink/8 text-ink/60",
  accent: "bg-primary/15 text-primary",
};

/**
 * Shared status pill (Part: UI/UX Redesign, 2026-09-01) — generalizes the
 * page-local `SourceBadge`/`StagePill` functions in app/(dashboard)/leads/
 * page.tsx and the inline "Sent"/"Lead: X" pills in
 * components/email-hub/message-detail-panel.tsx into one reusable
 * component, so every status pill in the app shares the same shape/sizing
 * and only the tone (semantic color) varies per call site.
 */
export function StatusBadge({ tone = "neutral", label }: { tone?: Tone; label: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE_CLASSES[tone]}`}>
      {label}
    </span>
  );
}
