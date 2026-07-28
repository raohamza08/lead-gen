import { Nav } from "../../components/nav";
import { AuthGuard } from "../../components/auth-guard";
import { SignOutButton } from "../../components/sign-out-button";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div>
        <header className="flex items-center justify-between border-b border-[var(--line)] px-6 py-4">
          <span className="text-lg font-semibold tracking-tight">Pipeline</span>
          <SignOutButton />
        </header>
        <Nav />
        <main className="p-6">{children}</main>
      </div>
    </AuthGuard>
  );
}
