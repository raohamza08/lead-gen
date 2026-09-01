"use client";

import { forwardRef } from "react";
import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

const FIELD_BASE =
  "w-full rounded-lg border bg-transparent px-3 py-2 text-sm text-ink transition-colors duration-fast placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50";

function fieldBorder(error?: boolean): string {
  return error ? "border-[rgb(var(--bad-rgb)/0.5)] focus:border-error" : "border-[var(--line)] focus:border-primary";
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

/** Shared text input (Part: UI/UX Redesign, 2026-09-01) — replaces the ad
 *  hoc `<input className="...">` markup repeated across compose-modal.tsx,
 *  settings sections, and elsewhere. `error` just swaps the border/focus
 *  color; the actual error message is a caller concern (rendered below the
 *  field), consistent with how forms already report errors in this app. */
export const Input = forwardRef<HTMLInputElement, InputProps>(({ error, className = "", ...props }, ref) => (
  <input ref={ref} className={`${FIELD_BASE} ${fieldBorder(error)} ${className}`} {...props} />
));
Input.displayName = "Input";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ error, className = "", ...props }, ref) => (
  <textarea ref={ref} className={`${FIELD_BASE} ${fieldBorder(error)} ${className}`} {...props} />
));
Textarea.displayName = "Textarea";
