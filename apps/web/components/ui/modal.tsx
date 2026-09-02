"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

/**
 * Shared modal (Part: UI/UX Redesign, 2026-09-01) — replaces two independent
 * hand-rolled overlays with no `role="dialog"` or focus trap:
 * components/email-hub/compose-modal.tsx (a centered dialog) and
 * components/email-hub/message-detail-panel.tsx (a slide-over panel).
 * Radix Dialog supplies both for free (focus trap, ESC-to-close,
 * backdrop-click-to-close, `aria-modal`) — this file only adds the visual
 * variant and the enter/exit animation, keyed off Radix's own [data-state]
 * so unmount timing is Radix's problem, not ours.
 */
export function Modal({
  open,
  onOpenChange,
  variant = "center",
  title,
  contentClassName,
  bodyClassName,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant?: "center" | "drawer-right";
  /** Omit when the caller builds its own header (see ModalTitle/ModalClose)
   *  — a real Radix-labeled title is still required for accessibility in
   *  that case, just rendered by the caller instead of here. */
  title?: string;
  /** Replaces (not appends to) the default width classes — appending would
   *  leave both `max-w-lg` and a caller's override present at once, and
   *  which one wins depends on Tailwind's generated CSS order, not on
   *  className string order. Defaults to `w-full max-w-lg` when omitted. */
  contentClassName?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const isDrawer = variant === "drawer-right";
  const structuralClasses = isDrawer
    ? "modal-content-drawer fixed inset-y-0 right-0 z-50 flex flex-col overflow-y-auto border-l border-[var(--line)] bg-surface shadow-lg focus:outline-none"
    : "modal-content-center fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-[var(--radius)] border border-[var(--line)] bg-surface p-5 shadow-lg focus:outline-none";
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="modal-overlay fixed inset-0 z-40 bg-ink/40 backdrop-blur-[1px]" />
        <DialogPrimitive.Content className={`${structuralClasses} ${contentClassName ?? "w-full max-w-lg"}`}>
          {title && (
            <div className={`flex items-center justify-between ${isDrawer ? "border-b border-[var(--line)] px-5 py-4" : "mb-4"}`}>
              <DialogPrimitive.Title className="text-section-title text-ink">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Close
                aria-label="Close"
                className="rounded-md p-1 text-ink/50 transition-colors duration-fast hover:bg-ink/5 hover:text-ink"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </DialogPrimitive.Close>
            </div>
          )}
          <div className={bodyClassName ?? (isDrawer ? "flex-1 px-5 py-4" : "flex-1")}>{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const ModalClose = DialogPrimitive.Close;
export const ModalTitle = DialogPrimitive.Title;
