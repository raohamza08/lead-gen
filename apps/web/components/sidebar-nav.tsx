"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

interface NavLink {
  href: string;
  label: string;
  /** Exact-match override for links that share a pathname and differ only by
   *  query string (the Email Hub's view switcher) — plain startsWith would
   *  make every one of those links show active at once. */
  matchSearch?: string;
}

type NavItem =
  | { type: "link"; href: string; label: string }
  | { type: "group"; label: string; links: NavLink[] };

/**
 * The dashboard's information architecture (Part: Overall Dashboard
 * Structure) — a persistent left sidebar replacing the old horizontal
 * `<Nav>` bar. "Lead Generation" groups every route the existing system
 * already had, unchanged; "Email Hub" is the new module. Nothing under
 * Lead Generation moved or was rebuilt — this is purely a navigation
 * re-home, same pattern `nav.tsx`'s GROUPS constant already used, just
 * rendered vertically and one level deeper.
 */
const NAV: NavItem[] = [
  { type: "link", href: "/overview", label: "Dashboard" },
  {
    type: "group",
    label: "Lead Generation",
    links: [
      { href: "/leads", label: "Leads" },
      { href: "/pipeline", label: "Pipeline" },
      { href: "/sequences", label: "Sequences" },
      { href: "/campaigns", label: "Campaigns" },
      { href: "/analytics", label: "Analytics" },
      { href: "/automation", label: "Automation" },
      { href: "/settings/lead-generation", label: "Settings" },
    ],
  },
  {
    type: "group",
    label: "Email Hub",
    links: [
      { href: "/email-hub", label: "Unified Inbox", matchSearch: "" },
      { href: "/email-hub?view=important", label: "Important", matchSearch: "view=important" },
      { href: "/email-hub?view=leads", label: "Leads", matchSearch: "view=leads" },
      { href: "/email-hub?view=followups", label: "Follow-ups", matchSearch: "view=followups" },
      { href: "/email-hub?view=ignored", label: "Ignored", matchSearch: "view=ignored" },
      { href: "/email-hub?view=sent", label: "Sent", matchSearch: "view=sent" },
      { href: "/settings/email-hub", label: "Settings" },
    ],
  },
  {
    type: "group",
    label: "Social Media",
    links: [
      { href: "/social-media", label: "Overview" },
      { href: "/social-media/accounts", label: "Accounts" },
      { href: "/social-media/create", label: "Create Post" },
      { href: "/social-media/posts", label: "Posts" },
      { href: "/social-media/calendar", label: "Calendar" },
      { href: "/social-media/media", label: "Media Library" },
      { href: "/social-media/templates", label: "Templates" },
      { href: "/social-media/automations", label: "Automations" },
      { href: "/settings/social-media", label: "Settings" },
    ],
  },
  { type: "link", href: "/settings", label: "Settings" },
];

function isActive(pathname: string | null, search: string, link: NavLink): boolean {
  const [linkPath] = link.href.split(/[?#]/);
  if (pathname !== linkPath) return false;
  if (link.matchSearch === undefined) return true;
  return search === link.matchSearch;
}

export function SidebarNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? "";

  // Auto-expand whichever group contains the current page, so a direct link
  // or refresh never lands on a page whose group looks collapsed/unselected.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const item of NAV) {
      if (item.type === "group") {
        initial[item.label] = !item.links.some((l) => isActive(pathname, search, l));
      }
    }
    return initial;
  });

  return (
    <nav className="flex h-full w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-[var(--line)] p-3">
      {NAV.map((item) => {
        if (item.type === "link") {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                active ? "bg-accent font-medium text-white shadow-sm" : "text-ink/65 hover:bg-ink/5 hover:text-ink"
              }`}
            >
              {item.label}
            </Link>
          );
        }

        const isOpen = !collapsed[item.label];
        return (
          <div key={item.label} className="flex flex-col">
            <button
              type="button"
              onClick={() => setCollapsed((c) => ({ ...c, [item.label]: !c[item.label] }))}
              className="flex items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink/50 hover:text-ink/80"
            >
              {item.label}
              <span aria-hidden className={`transition-transform ${isOpen ? "rotate-90" : ""}`}>
                ›
              </span>
            </button>
            {isOpen && (
              <div className="ml-1 flex flex-col gap-0.5 border-l border-[var(--line)] pl-2">
                {item.links.map((link) => {
                  const active = isActive(pathname, search, link);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      aria-current={active ? "page" : undefined}
                      className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                        active ? "bg-accent font-medium text-white shadow-sm" : "text-ink/65 hover:bg-ink/5 hover:text-ink"
                      }`}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
