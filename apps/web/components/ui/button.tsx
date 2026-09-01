"use client";

import { Slot } from "@radix-ui/react-slot";
import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { EurosHubLoader } from "./euroshub-loader";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-primary text-white hover:opacity-90 active:opacity-80",
  secondary: "border border-[var(--line)] text-ink/75 hover:bg-ink/5 active:bg-ink/10",
  ghost: "text-ink/65 hover:bg-ink/5 active:bg-ink/10",
  danger: "border border-[rgb(var(--bad-rgb)/0.4)] text-error hover:bg-[rgb(var(--bad-rgb)/0.08)] active:bg-[rgb(var(--bad-rgb)/0.14)]",
  success: "bg-success text-white hover:opacity-90 active:opacity-80",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "px-2.5 py-1.5 text-xs gap-1.5",
  md: "px-3.5 py-2 text-sm gap-2",
  lg: "px-4 py-2.5 text-sm gap-2",
  icon: "p-2",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  asChild?: boolean;
}

/**
 * Shared button (Part: UI/UX Redesign, 2026-09-01) — replaces the hand-rolled
 * `<button className="...">` markup repeated across leads/email-hub/profile/
 * overview/etc. with genuinely inconsistent padding/radius/text-size. Colors
 * follow the semantics those pages already agreed on in spirit (accent =
 * primary, bordered = secondary, bad-colored = danger); this just makes it
 * one component instead of one copy-pasted class string per instance.
 *
 * `loading` keeps the button's committed width by reserving space for the
 * label (opacity-0, not removed) and overlaying EurosHubLoader in
 * mode="button" absolutely centered — a loading button never shifts width or
 * loses its layout slot. `asChild` (via Radix Slot) lets a Next `<Link>`
 * render as a real Button visually without an extra wrapper element.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", loading = false, asChild = false, disabled, className = "", children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        disabled={disabled || loading}
        className={`relative inline-flex shrink-0 items-center justify-center rounded-lg font-medium transition-colors duration-fast ease-standard disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
        {...props}
      >
        {loading && (
          <span className="absolute inset-0 flex items-center justify-center">
            <EurosHubLoader mode="button" size={16} />
          </span>
        )}
        <span className={loading ? "invisible" : "contents"}>{children}</span>
      </Comp>
    );
  },
);
Button.displayName = "Button";
