"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { SidebarNav } from "../../components/sidebar-nav";
import { AuthGuard } from "../../components/auth-guard";
import { ThemeToggle } from "../../components/theme-toggle";
import { AccentPicker } from "../../components/accent-picker";
import { NotificationsBell } from "../../components/notifications-bell";
import { HeaderUserMenu } from "../../components/header-user-menu";
import { QueryProvider } from "../../components/query-provider";
import { AiAssistantPanel } from "../../components/ai-assistant-panel";
import { Popover, PopoverAnchor, PopoverContent } from "../../components/ui/popover";
import { api } from "../../lib/api-client";

interface SearchHit {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

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

  // Real global search (Part: EBOS-inspired shell redesign round 2,
  // 2026-10-21) — same 300ms-debounce convention as leads/page.tsx's own
  // search box, the only other debounced input in this codebase.
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);
  // Explicit dismiss (Esc/outside-click/clicking a result) so the popover
  // doesn't immediately reopen on its own next render while the same query
  // is still sitting in the box.
  const [searchDismissed, setSearchDismissed] = useState(false);
  useEffect(() => setSearchDismissed(false), [debouncedSearch]);

  const searchQuery = useQuery({
    queryKey: ["global-search", debouncedSearch],
    queryFn: () => api.globalSearch(debouncedSearch) as Promise<Record<"leads" | "emails" | "social" | "upwork", SearchHit[]>>,
    enabled: debouncedSearch.length >= 2,
  });
  const searchOpen = !searchDismissed && debouncedSearch.length >= 2;
  const results = searchQuery.data;
  const hasAnyResults = Boolean(
    results && (results.leads.length || results.emails.length || results.social.length || results.upwork.length),
  );

  function closeSearch() {
    setSearchDismissed(true);
  }

  function renderResultGroup(label: string, items: SearchHit[]) {
    if (!items.length) return null;
    return (
      <div key={label}>
        <div className="px-2 py-1 text-label uppercase text-ink/45">{label}</div>
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            onClick={closeSearch}
            className="flex flex-col rounded-lg px-2.5 py-1.5 text-sm text-ink/80 transition-colors duration-fast hover:bg-ink/5"
          >
            <span className="truncate">{item.title}</span>
            {item.subtitle && <span className="truncate text-xs text-ink/45">{item.subtitle}</span>}
          </Link>
        ))}
      </div>
    );
  }

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
                <div className="flex items-center gap-1">
                  <div>
                    <div className="text-section-title leading-tight text-ink">Outly OS</div>
                    <div className="hidden text-metadata leading-tight text-ink/45 sm:block">Business Communication & Lead Management</div>
                  </div>
                  {/* Visual-only chevron (Part: EBOS-inspired shell redesign,
                      2026-10-21, explicit user request — restyle the top bar's
                      chrome to match EBOS's company-switcher look). No
                      multi-org switching exists in Outly; this is decorative,
                      matching the user's explicit "chrome only, no new
                      functionality" decision for this part of the redesign. */}
                  <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-ink/35">
                    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
              {/* Real global search (Part: EBOS-inspired shell redesign
                  round 2, 2026-10-21) -- fans out to leads/email/social/
                  upwork via GET /search, each gated by the user's own
                  existing module-access flags server-side. */}
              <div className="hidden flex-1 justify-center px-6 lg:flex">
                <Popover open={searchOpen} onOpenChange={(o) => !o && closeSearch()}>
                  <PopoverAnchor asChild>
                    <label className="glass-surface flex w-full max-w-md items-center gap-2 rounded-full border border-[var(--line)] px-3.5 py-2 text-ink/45">
                      <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" className="shrink-0">
                        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                        <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                      <input
                        type="text"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        placeholder="Search..."
                        className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink/40 focus:outline-none"
                      />
                      <kbd className="shrink-0 rounded border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-ink/40">Ctrl K</kbd>
                    </label>
                  </PopoverAnchor>
                  <PopoverContent
                    align="center"
                    className="max-h-[70vh] w-[420px] overflow-y-auto p-2"
                    onOpenAutoFocus={(e) => e.preventDefault()}
                  >
                    {searchQuery.isFetching && <div className="px-2.5 py-2 text-xs text-ink/45">Searching…</div>}
                    {!searchQuery.isFetching && !hasAnyResults && <div className="px-2.5 py-2 text-xs text-ink/45">No results.</div>}
                    {results && (
                      <div className="flex flex-col gap-2">
                        {renderResultGroup("Leads", results.leads)}
                        {renderResultGroup("Email", results.emails)}
                        {renderResultGroup("Social", results.social)}
                        {renderResultGroup("Upwork", results.upwork)}
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex items-center gap-2">
                {/* Real AI chat assistant (Part: EBOS-inspired shell
                    redesign round 2, 2026-10-21) -- opens a drawer-right
                    panel backed by Gemini, grounded in this user's own
                    permission-filtered Outly data. */}
                <button
                  type="button"
                  title="AI"
                  onClick={() => setAssistantOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-xs font-medium text-ink/70 transition-colors duration-fast hover:bg-ink/5"
                >
                  <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                    <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.6" />
                  </svg>
                  AI
                </button>
                <NotificationsBell />
                <AccentPicker />
                <ThemeToggle />
                <HeaderUserMenu />
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
