import { Nav } from "../../components/nav";
import { AuthGuard } from "../../components/auth-guard";
import { SignOutButton } from "../../components/sign-out-button";
import { ThemeToggle } from "../../components/theme-toggle";
import { NotificationsBell } from "../../components/notifications-bell";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="min-h-screen">
        {/* Sticky so the nav stays reachable on the pipeline board, which
            scrolls horizontally and can be long vertically. */}
        <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--paper)]/90 backdrop-blur">
          <div className="flex items-center justify-between px-6 py-3">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-xs font-bold text-white"
              >
                AI
              </span>
              <div>
                <div className="text-sm font-semibold leading-tight tracking-tight">Sales OS</div>
                <div className="text-[11px] leading-tight text-ink/45">Revenue intelligence</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <NotificationsBell />
              <ThemeToggle />
              <SignOutButton />
            </div>
          </div>
          <Nav />
        </header>
        <main className="mx-auto max-w-[1600px] p-6">{children}</main>
      </div>
    </AuthGuard>
  );
}
