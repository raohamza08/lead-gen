"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Grouped so the bar reads as three jobs rather than nine flat links: what's
 * happening, who we're contacting, and how it's configured. At nine items a
 * flat list stops being scannable.
 */
const GROUPS: { label: string; links: { href: string; label: string }[] }[] = [
  {
    label: "Monitor",
    links: [
      { href: "/overview", label: "Overview" },
      { href: "/analytics", label: "Analytics" },
      { href: "/automation", label: "Automation" },
    ],
  },
  {
    label: "Work",
    links: [
      { href: "/leads", label: "Leads" },
      { href: "/pipeline", label: "Pipeline" },
      { href: "/sequences", label: "Sequences" },
    ],
  },
  {
    label: "Configure",
    links: [
      { href: "/campaigns", label: "Campaigns" },
      { href: "/settings", label: "Settings" },
    ],
  },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-[var(--line)] px-6 py-2.5">
      {GROUPS.map((group, i) => (
        <div key={group.label} className="flex items-center gap-1">
          {i > 0 && <span aria-hidden className="mr-4 h-4 w-px bg-[var(--line)]" />}
          {group.links.map((link) => {
            const active = pathname?.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                // hover:bg-ink/5 rather than black/5 — a black wash is invisible
                // against the dark-mode surface.
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-accent font-medium text-white shadow-sm"
                    : "text-ink/65 hover:bg-ink/5 hover:text-ink"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
