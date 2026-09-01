"use client";

import { Suspense, useState } from "react";
import { SidebarNav } from "../../components/sidebar-nav";
import { AuthGuard } from "../../components/auth-guard";
import { ThemeToggle } from "../../components/theme-toggle";
import { NotificationsBell } from "../../components/notifications-bell";
import { HeaderUserMenu } from "../../components/header-user-menu";
import { QueryProvider } from "../../components/query-provider";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Mobile-only drawer state (Part: UI/UX Redesign, 2026-09-01) — below `md`
  // the sidebar was previously just... absent, with no way to reach it at
  // all. Independent of SidebarNav's own desktop collapse-to-icons state,
  // which persists across sessions; this one resets to closed on every page
  // load, matching how a drawer is expected to behave.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <QueryProvider>
      <AuthGuard>
        <div className="flex h-screen flex-col bg-background">
          <header className="shrink-0 border-b border-[var(--line)] bg-background/90 backdrop-blur">
            <div className="flex items-center justify-between px-4 py-3 sm:px-6">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(true)}
                  aria-label="Open navigation"
                  className="-ml-1.5 rounded-md p-1.5 text-ink/70 transition-colors duration-fast hover:bg-ink/5 md:hidden"
                >
                  <svg aria-hidden width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.png" alt="" aria-hidden className="h-7 w-7 object-contain" />
                <div>
                  <div className="text-section-title leading-tight text-ink">Outly OS</div>
                  <div className="hidden text-metadata leading-tight text-ink/45 sm:block">Business Communication & Lead Management</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <NotificationsBell />
                <ThemeToggle />
                <HeaderUserMenu />
              </div>
            </div>
          </header>
          <div className="flex min-h-0 flex-1">
            <Suspense fallback={<div className="hidden w-56 shrink-0 border-r border-[var(--line)] md:block" />}>
              <SidebarNav mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
            </Suspense>
            <main className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
              <div className="mx-auto max-w-[1600px]">{children}</div>
            </main>
          </div>
        </div>
      </AuthGuard>
    </QueryProvider>
  );
}
