import { Nav } from "../../components/nav";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <header className="border-b border-[var(--line)] px-6 py-4">
        <span className="text-lg font-semibold tracking-tight">Pipeline</span>
      </header>
      <Nav />
      <main className="p-6">{children}</main>
    </div>
  );
}
