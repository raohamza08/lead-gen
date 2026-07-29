"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/overview", label: "Overview" },
  { href: "/leads", label: "Leads" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/sequences", label: "Sequences" },
  { href: "/analytics", label: "Analytics" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/automation", label: "Automation" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 border-b border-[var(--line)] px-6 py-3">
      {LINKS.map((link) => {
        const active = pathname?.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            // hover:bg-ink/5 rather than black/5 so the hover state is visible
            // in dark mode too, where a black wash is invisible.
            className={`rounded px-3 py-1.5 text-sm transition-colors ${
              active ? "bg-accent text-white" : "text-ink/70 hover:bg-ink/5"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
