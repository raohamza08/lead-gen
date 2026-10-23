"use client";

import { Suspense, useState } from "react";
import { SidebarNav } from "../../components/sidebar-nav";
import { AuthGuard } from "../../components/auth-guard";
import { ThemeToggle } from "../../components/theme-toggle";
import { NotificationsBell } from "../../components/notifications-bell";
import { HeaderUserMenu } from "../../components/header-user-menu";
import { QueryProvider } from "../../components/query-provider";
import { AiAssistantPanel } from "../../components/ai-assistant-panel";
import { GlobalSearch } from "../../components/global-search";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Mobile-only drawer state (Part: UI/UX Redesign, 2026-09-01) — below `md`
  // the sidebar was previously just... absent, with no way to reach it at
  // all. Independent of SidebarNav's own desktop collapse-to-icons state,
  // which persists across sessions; this one resets to closed on every page
  // load, matching how a drawer is expected to behave.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Real AI chat assistant (Part: EBOS-inspired shell redesign round 2,
  // 2026-10-21) — the header "AI" button was previously decorative only.
  const [assistantOpen, setAssistantOpen] = useState(false);

  return (
    <QueryProvider>
      <AuthGuard>
        <div className="flex h-screen flex-col bg-background">
          {/* Top bar — 48px tall, full width, brand-blue background, white
              text/icons throughout (Part: full UI redesign per UI.md,
              Section 6.1). Replaces the previous translucent/light header;
              fixed `bg-accent`/white colors rather than --surface since this
              bar's own look doesn't change between light/dark theme, same
              as Outlook's real top bar. */}
          <header className="h-12 shrink-0 bg-accent">
            <div className="flex h-full items-center gap-2 px-2">
              {/* Mobile nav toggle — spec has no mobile breakpoint of its
                  own, so this reuses the spec's 48x48 icon-button slot,
                  swapped for a real hamburger only below `md`. */}
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open navigation"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded text-white transition-colors hover:bg-white/15 md:hidden"
              >
                <svg aria-hidden width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
              {/* 9-dot "app launcher" (Section 6.1) — decorative, same as
                  the spec's own description; no multi-app launcher exists
                  in Outly to open. */}
              <button
                type="button"
                title="Apps"
                aria-hidden
                tabIndex={-1}
                className="hidden h-12 w-12 shrink-0 items-center justify-center rounded text-white transition-colors hover:bg-white/15 md:flex"
              >
                <svg aria-hidden width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
                  {[0, 1, 2].map((row) =>
                    [0, 1, 2].map((col) => <circle key={`${row}-${col}`} cx={2 + col * 7} cy={2 + row * 7} r="1.6" />),
                  )}
                </svg>
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="" aria-hidden className="h-6 w-6 shrink-0 object-contain" />
              <span className="shrink-0 text-[18px] font-semibold text-white">Outly OS</span>

              {/* Centered white search pill (Section 6.1). */}
              <div className="hidden flex-1 justify-center px-4 lg:flex">
                <GlobalSearch />
              </div>
              <div className="flex-1 lg:hidden" />

              {/* Right side: evenly spaced 48x48 icon buttons, avatar
                  rightmost (Section 6.1). Real AI chat assistant (backed by
                  Gemini, grounded in this user's own permission-filtered
                  Outly data) repurposes the spec's "more features" slot. */}
              <div className="flex shrink-0 items-center">
                <button
                  type="button"
                  title="AI"
                  aria-label="AI assistant"
                  onClick={() => setAssistantOpen(true)}
                  className="flex h-12 w-12 items-center justify-center rounded text-white transition-colors hover:bg-white/15"
                >
                  <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                    <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.6" />
                  </svg>
                </button>
                <NotificationsBell />
                <ThemeToggle />
                <div className="flex h-12 w-12 items-center justify-center">
                  <HeaderUserMenu />
                </div>
              </div>
            </div>
          </header>
          <div className="flex min-h-0 flex-1">
            <Suspense fallback={<div className="hidden w-[260px] shrink-0 border-r border-[var(--line)] md:block" />}>
              <SidebarNav mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
            </Suspense>
            <main className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
              <div className="mx-auto max-w-[1600px]">{children}</div>
            </main>
          </div>
        </div>
        <AiAssistantPanel open={assistantOpen} onOpenChange={setAssistantOpen} />
      </AuthGuard>
    </QueryProvider>
  );
}
