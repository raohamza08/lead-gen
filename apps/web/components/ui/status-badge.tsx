type Tone = "success" | "warning" | "error" | "info" | "neutral" | "accent";

// A thin border at ~30% of the tone's own colour, matching the approved
// dashboard-preview.html mockup's pill construction (Part: Dashboard Center
// card-format match, 2026-10-19) — a tinted fill alone read as flatter/less
// deliberate than the mockup's pills once compared side by side.
const TONE_CLASSES: Record<Tone, string> = {
  success: "bg-success/12 text-success border border-success/30",
  warning: "bg-warning/15 text-warning border border-warning/30",
  error: "bg-error/12 text-error border border-error/30",
  info: "bg-info/12 text-info border border-info/30",
  neutral: "bg-ink/8 text-ink/60 border border-[var(--line)]",
  accent: "bg-primary/15 text-primary border border-primary/30",
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
