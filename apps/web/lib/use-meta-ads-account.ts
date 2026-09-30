"use client";

import { useEffect, useState } from "react";

const KEY = "meta-ads-selected-account";

/** Persists which connected Meta ad account is selected across the module's
 *  pages (Overview/Campaigns/Ad Sets/Ads) — same localStorage-persisted,
 *  no-Context-needed pattern sidebar-nav.tsx already uses for its own
 *  collapse state, rather than introducing a React Context just for this. */
export function useSelectedMetaAdAccount(accounts: { id: string }[] | undefined) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!accounts || accounts.length === 0) return;
    const stored = window.localStorage.getItem(KEY);
    const valid = stored && accounts.some((a) => a.id === stored);
    setSelectedId(valid ? (stored as string) : accounts[0].id);
  }, [accounts]);

  function select(id: string) {
    window.localStorage.setItem(KEY, id);
    setSelectedId(id);
  }

  return [selectedId, select] as const;
}
