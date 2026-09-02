"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { useRealtimeRefetch } from "../lib/realtime";

interface NavLink {
  href: string;
  label: string;
  /** Exact-match override for links that share a pathname and differ only by
   *  query string (the Email Hub's view switcher) — plain startsWith would
   *  make every one of those links show active at once. */
  matchSearch?: string;
  /** Which field of GET /email-hub/stats this link's unread badge reads
   *  (Part: reliability overhaul, 2026-08-31) — e.g. "unread" for Unified
   *  Inbox. Omitted for links with no meaningful unread count (Leads,
   *  Follow-ups, Sent, Settings). */
  countKey?: "unread" | "important" | "ignored";
}

type ModuleFlag = "leadGenAccess" | "emailHubAccess" | "socialMediaAccess";

type NavItem =
  | { type: "link"; href: string; label: string; moduleFlag?: ModuleFlag; requiresPrimaryAdmin?: boolean }
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
    label: "Lead Room",
    links: [{ href: "/leads", label: "Leads" }],
  },
  {
    type: "group",
    label: "Lead Generation",
    links: [
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
      { href: "/email-hub", label: "Unified Inbox", matchSearch: "", countKey: "unread" },
      { href: "/email-hub?view=important", label: "Important", matchSearch: "view=important", countKey: "important" },
      { href: "/email-hub?view=leads", label: "Leads", matchSearch: "view=leads" },
      { href: "/email-hub?view=followups", label: "Follow-ups", matchSearch: "view=followups" },
      { href: "/email-hub?view=ignored", label: "Ignored", matchSearch: "view=ignored", countKey: "ignored" },
      { href: "/email-hub?view=sent", label: "Sent", matchSearch: "view=sent" },
      { href: "/email-hub?view=tracked", label: "Tracked", matchSearch: "view=tracked" },
      { href: "/settings/email-hub", label: "Settings" },
    ],
  },
  { type: "link", href: "/social-inbox", label: "Social Inbox", moduleFlag: "socialMediaAccess" },
  {
    type: "group",
    label: "Social Media",
    links: [
      { href: "/social-media/accounts", label: "Accounts" },
      { href: "/social-media/linkedin", label: "LinkedIn" },
      { href: "/social-media/instagram", label: "Instagram" },
      { href: "/social-media/facebook", label: "Facebook" },
      { href: "/social-media/whatsapp", label: "WhatsApp" },
      { href: "/social-media/x", label: "X" },
      { href: "/social-media/calendar", label: "Calendar" },
      { href: "/social-media/automations", label: "Automations" },
      { href: "/settings/social-media", label: "Settings" },
    ],
  },
  // My Profile deliberately isn't a nav entry (Part: UI/UX Redesign,
  // 2026-09-01) — it moved into HeaderUserMenu's dropdown, which is now the
  // only place it's reachable from; it used to be duplicated here too.
  { type: "link", href: "/settings", label: "Settings" },
  // Not a moduleFlag gate — System Logs is restricted to the org's single
  // primary admin (Part: Admin/System Logs, 2026-08-31), distinct from the
  // shared Role.ADMIN. This entry is UX-only; the real enforcement is
  // PrimaryAdminGuard on the backend route.
  { type: "link", href: "/admin/system-logs", label: "System Logs", requiresPrimaryAdmin: true },
];

/** Maps a NAV group's label to the module flag from GET /users/me that gates it. */
const MODULE_FLAG_BY_GROUP: Record<string, ModuleFlag> = {
  "Lead Room": "leadGenAccess",
  "Lead Generation": "leadGenAccess",
  "Email Hub": "emailHubAccess",
  "Social Media": "socialMediaAccess",
};

function isActive(pathname: string | null, search: string, link: NavLink): boolean {
  const [linkPath] = link.href.split(/[?#]/);
  if (pathname !== linkPath) return false;
  if (link.matchSearch === undefined) return true;
  return search === link.matchSearch;
}

const SIDEBAR_COLLAPSED_KEY = "sidebar-collapsed";

export function SidebarNav({
  mobileOpen,
  onMobileClose,
}: {
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? "";
  const queryClient = useQueryClient();

  // null = still loading (or fetch failed) — default every module visible in
  // that case so there's no flash-of-empty-sidebar; the backend's
  // ModuleAccessGuard is what actually enforces this either way, this is UX
  // discoverability only.
  const [moduleAccess, setModuleAccess] = useState<Record<string, boolean> | null>(null);
  // Fails CLOSED, unlike moduleAccess above — System Logs must never flash
  // visible to a non-admin even briefly while /users/me is loading (Part:
  // Admin/System Logs, 2026-08-31 — "hidden from unauthorized users" is the
  // point, unlike the other three flags where fail-open is fine).
  const [isPrimaryAdmin, setIsPrimaryAdmin] = useState(false);

  useEffect(() => {
    api
      .getMe()
      .then((me) => {
        const m = me as { leadGenAccess: boolean; emailHubAccess: boolean; socialMediaAccess: boolean; isPrimaryAdmin: boolean };
        setModuleAccess({ leadGenAccess: m.leadGenAccess, emailHubAccess: m.emailHubAccess, socialMediaAccess: m.socialMediaAccess });
        setIsPrimaryAdmin(m.isPrimaryAdmin);
      })
      .catch(() => {});
  }, []);

  // Same query key as the Email Hub page's own stats query — one cache
  // entry, so this badge and that page's stats strip never disagree (Part:
  // reliability overhaul, 2026-08-31 — nav items previously showed no count
  // at all). Only fetched once module access is confirmed, to avoid a 403
  // for a user without Email Hub access.
  const statsQuery = useQuery({
    queryKey: ["email-stats"],
    queryFn: () => api.getEmailHubStats() as Promise<{ unread: number; important: number; ignored: number }>,
    enabled: Boolean(moduleAccess?.emailHubAccess),
  });
  useRealtimeRefetch(
    ["emailHub.messageReceived", "emailHub.messagesUpdated"],
    () => queryClient.invalidateQueries({ queryKey: ["email-stats"] }),
  );
  const stats = statsQuery.data;

  const visibleNav = NAV.filter((item) => {
    if (item.type === "link" && item.requiresPrimaryAdmin) return isPrimaryAdmin;
    const flag = item.type === "group" ? MODULE_FLAG_BY_GROUP[item.label] : item.moduleFlag;
    if (!flag || !moduleAccess) return true;
    return moduleAccess[flag];
  });

  // Auto-expand whichever group contains the current page, so a direct link
  // or refresh never lands on a page whose group looks collapsed/unselected.
  const [groupCollapsed, setGroupCollapsed] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const item of NAV) {
      if (item.type === "group") {
        initial[item.label] = !item.links.some((l) => isActive(pathname, search, l));
      }
    }
    return initial;
  });

  // Sidebar-wide collapse-to-icons (Part: UI/UX Redesign, 2026-09-01) — a
  // deliberately different concept from groupCollapsed above (which section
  // headers are expanded). Persisted the same way theme-toggle.tsx persists
  // its own preference: read once on mount (SSR has no localStorage, so this
  // starts false and settles after hydration — a one-frame width flash is an
  // acceptable trade for not needing a cookie round-trip just for this).
  const [iconsOnly, setIconsOnly] = useState(false);
  useEffect(() => {
    setIconsOnly(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
  }, []);
  function toggleIconsOnly() {
    setIconsOnly((v) => {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, v ? "0" : "1");
      return !v;
    });
  }

  function renderNav(compact: boolean, onNavigate?: () => void) {
    return (
      <>
        {visibleNav.map((item) => {
          if (item.type === "link") {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                title={compact ? item.label : undefined}
                className={`flex items-center rounded-lg text-sm transition-colors duration-fast ${
                  compact ? "justify-center px-2 py-2" : "gap-2.5 px-3 py-2"
                } ${active ? "bg-primary font-medium text-white shadow-sm" : "text-ink/65 hover:bg-ink/5 hover:text-ink"}`}
              >
                {compact ? (
                  <span aria-hidden className="flex h-5 w-5 items-center justify-center text-xs font-semibold">
                    {item.label[0]}
                  </span>
                ) : (
                  item.label
                )}
              </Link>
            );
          }

          const isOpen = compact || !groupCollapsed[item.label];
          return (
            <div key={item.label} className="flex flex-col">
              {!compact && (
                <button
                  type="button"
                  onClick={() => setGroupCollapsed((c) => ({ ...c, [item.label]: !c[item.label] }))}
                  className="flex items-center justify-between rounded-lg px-3 py-2 text-label uppercase text-ink/50 transition-colors duration-fast hover:text-ink/80"
                >
                  {item.label}
                  <span aria-hidden className={`transition-transform duration-fast ${isOpen ? "rotate-90" : ""}`}>
                    ›
                  </span>
                </button>
              )}
              {isOpen && (
                <div className={compact ? "flex flex-col gap-0.5" : "ml-1 flex flex-col gap-0.5 border-l border-[var(--line)] pl-2"}>
                  {item.links.map((link) => {
                    const active = isActive(pathname, search, link);
                    const count = link.countKey ? stats?.[link.countKey] ?? 0 : 0;
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        title={compact ? link.label : undefined}
                        className={`flex items-center justify-between rounded-lg text-sm transition-colors duration-fast ${
                          compact ? "justify-center px-2 py-2" : "px-3 py-1.5"
                        } ${active ? "bg-primary font-medium text-white shadow-sm" : "text-ink/65 hover:bg-ink/5 hover:text-ink"}`}
                      >
                        {compact ? (
                          <span aria-hidden className="flex h-5 w-5 items-center justify-center text-xs font-semibold">
                            {link.label[0]}
                          </span>
                        ) : (
                          <>
                            <span>{link.label}</span>
                            {count > 0 && (
                              <span
                                className={`tabular ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                  active ? "bg-white/25 text-white" : "bg-primary/15 text-primary"
                                }`}
                              >
                                {count > 99 ? "99+" : count}
                              </span>
                            )}
                          </>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </>
    );
  }

  return (
    <>
      {/* Desktop: persistent, collapsible to icons-only. Hidden below md,
          where the mobile drawer below takes over instead. */}
      <nav
        className={`hidden h-full shrink-0 flex-col gap-1 overflow-y-auto border-r border-[var(--line)] p-3 transition-[width] duration-normal ease-standard md:flex ${
          iconsOnly ? "w-16" : "w-56"
        }`}
      >
        <div className="flex flex-1 flex-col gap-1 overflow-y-auto">{renderNav(iconsOnly)}</div>
        <button
          type="button"
          onClick={toggleIconsOnly}
          aria-label={iconsOnly ? "Expand sidebar" : "Collapse sidebar"}
          title={iconsOnly ? "Expand sidebar" : "Collapse sidebar"}
          className="mt-1 flex items-center justify-center rounded-lg py-2 text-ink/50 transition-colors duration-fast hover:bg-ink/5 hover:text-ink/80"
        >
          <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" className={`transition-transform duration-normal ${iconsOnly ? "rotate-180" : ""}`}>
            <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </nav>

      {/* Mobile: overlay + slide-over drawer, always full-width (no
          icons-only mode — the drawer is already temporary, so nothing is
          gained by shrinking it further). */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-ink/40 backdrop-blur-[1px]"
            onClick={onMobileClose}
            aria-hidden
          />
          <nav className="animate-slide-in-left absolute inset-y-0 left-0 flex w-64 flex-col gap-1 overflow-y-auto border-r border-[var(--line)] bg-surface p-3 shadow-lg">
            {renderNav(false, onMobileClose)}
          </nav>
        </div>
      )}
    </>
  );
}
