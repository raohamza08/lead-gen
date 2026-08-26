import { Suspense } from "react";
import { SidebarNav } from "../../components/sidebar-nav";
import { AuthGuard } from "../../components/auth-guard";
import { SignOutButton } from "../../components/sign-out-button";
import { ThemeToggle } from "../../components/theme-toggle";
import { NotificationsBell } from "../../components/notifications-bell";
import { QueryProvider } from "../../components/query-provider";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <AuthGuard>
        <div className="flex h-screen flex-col">
          <header className="shrink-0 border-b border-[var(--line)] bg-[var(--paper)]/90 backdrop-blur">
            <div className="flex items-center justify-between px-6 py-3">
              <div className="flex items-center gap-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.png" alt="" aria-hidden className="h-7 w-7 object-contain" />
                <div>
                  <div className="text-sm font-semibold leading-tight tracking-tight">Outly OS</div>
                  <div className="text-[11px] leading-tight text-ink/45">Business Communication & Lead Management</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <NotificationsBell />
                <ThemeToggle />
                <SignOutButton />
              </div>
            </div>
          </header>
          <div className="flex min-h-0 flex-1">
            <Suspense fallback={<div className="w-56 shrink-0 border-r border-[var(--line)]" />}>
              <SidebarNav />
            </Suspense>
            <main className="min-w-0 flex-1 overflow-y-auto p-6">
              <div className="mx-auto max-w-[1600px]">{children}</div>
            </main>
          </div>
        </div>
      </AuthGuard>
    </QueryProvider>
  );
}
