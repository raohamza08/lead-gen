"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api-client";
import { Avatar } from "../avatar";

interface Me {
  name: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
}

function WhatsAppGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.4A10 10 0 1 0 12 2Zm0 1.8A8.2 8.2 0 1 1 6.8 17l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 0 1 12 3.8Zm-3.4 4a.9.9 0 0 0-.6.3c-.2.2-.8.8-.8 1.9s.8 2.2.9 2.4c.1.1 1.6 2.5 3.9 3.5 1.9.8 2.3.7 2.7.6.6-.1 1.3-.5 1.5-1 .2-.5.2-1 .1-1.1-.1-.1-.2-.2-.5-.3l-1.5-.7c-.2-.1-.4-.1-.5.1l-.6.8c-.1.1-.2.2-.4.1-.2-.1-.9-.3-1.7-1-.6-.6-1-1.3-1.2-1.5-.1-.2 0-.3.1-.4l.4-.5c.1-.1.1-.3.1-.4 0-.1-.5-1.3-.7-1.8-.2-.4-.4-.4-.5-.4h-.5Z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M6 8a6 6 0 1 1 12 0c0 4.5 1.5 6 1.5 6h-15S6 12.5 6 8Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 18a2 2 0 0 0 4 0" strokeLinecap="round" />
    </svg>
  );
}

const BAR_BG = "#0b1f1a";

/**
 * Module header bar (Part: WhatsApp module UI redesign, 2026-10-27, explicit
 * user request following a reference screenshot — "update the ui as i given
 * you in the picture", after an earlier pass that only reskinned the accent
 * color was rejected as not matching the picture). Replaces the plain
 * `<h1>` + page-background `<Tabs>` both WhatsApp pages used before with a
 * self-contained dark bar matching the screenshot's layout: brand glyph +
 * title, inline Inbox/Numbers(/Feed/Accounts) pills, and a search/bell/
 * avatar cluster on the right.
 *
 * The search and bell icons are deliberately decorative (aria-hidden,
 * tabIndex={-1}, no onClick) rather than wired to fake behavior — there's no
 * per-module search or notification feed to open here, and a clickable-
 * looking control that does nothing is worse than one that's honestly inert.
 * Same convention the app's own global header already uses for its "Apps"
 * launcher icon (DashboardLayout, apps/web/app/(dashboard)/layout.tsx) for
 * the identical reason. The avatar is real, though — same `["me"]` query
 * HeaderUserMenu already keeps warm, so no extra request most of the time.
 *
 * Fixed near-black background regardless of the app's light/dark theme
 * toggle, same reasoning the global header already documents for its own
 * fixed `bg-accent` bar: this brand bar's look isn't meant to change with
 * the theme, matching the always-dark bar in the reference screenshot.
 */
export function WhatsAppHeaderBar({
  label,
  tabs,
  tab,
  onTabChange,
}: {
  label: string;
  tabs: { value: string; label: string }[];
  tab: string;
  onTabChange: (value: string) => void;
}) {
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => api.getMe() as Promise<Me> });
  const me = meQuery.data;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl px-4 py-2.5" style={{ background: BAR_BG }}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-white">
        <WhatsAppGlyph />
      </span>
      <span className="shrink-0 text-[15px] font-semibold text-white">{label}</span>

      <div className="flex items-center gap-1.5" role="tablist" aria-label={`${label} sections`}>
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            onClick={() => onTabChange(t.value)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
              tab === t.value ? "bg-accent text-white" : "border border-white/15 text-white/70 hover:bg-white/10"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-1 text-white/70">
        <button type="button" aria-hidden tabIndex={-1} className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-white/10">
          <SearchIcon />
        </button>
        <button type="button" aria-hidden tabIndex={-1} className="relative flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-white/10">
          <BellIcon />
          <span aria-hidden className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
        </button>
        {me && (
          <span className="relative ml-1 shrink-0">
            <Avatar name={me.displayName || me.name} email={me.email} avatarUrl={me.avatarUrl} sizeClass="h-8 w-8 text-xs" />
            <span aria-hidden className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2" style={{ background: "rgb(var(--accent-rgb))", borderColor: BAR_BG }} />
          </span>
        )}
      </div>
    </div>
  );
}
