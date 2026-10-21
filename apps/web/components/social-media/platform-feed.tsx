"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api-client";
import { Tabs } from "../ui/tabs";
import { EmptyState } from "../ui/empty-state";
import { AccountFeed } from "./account-feed";

interface SocialAccountItem {
  id: string;
  platform: string;
  username: string;
  displayName: string | null;
}

/**
 * A platform's Feed tab (Part: Social Inbox removal / per-module messaging,
 * 2026-10-21) — Feed is inherently per-account (Meta's/LinkedIn's APIs have
 * no "all my pages combined" feed endpoint), so with more than one connected
 * account for this platform, an account switcher sits above the same
 * AccountFeed that already renders at /social-media/accounts/[id] — same
 * switcher convention Email Hub uses for its own mailbox tabs.
 */
export function PlatformFeed({ platform }: { platform: string }) {
  const accountsQuery = useQuery({
    queryKey: ["social-media-accounts"],
    queryFn: () => api.getSocialAccounts() as Promise<SocialAccountItem[]>,
  });
  const accounts = (accountsQuery.data ?? []).filter((a) => a.platform === platform);
  const [accountId, setAccountId] = useState<string>("");
  const selected = accountId || accounts[0]?.id;

  if (accountsQuery.isLoading) return <p className="text-sm text-ink/50">Loading…</p>;
  if (accounts.length === 0) {
    return <EmptyState title="No account connected" description="Connect an account from the Accounts tab to see its feed here." />;
  }

  return (
    <div className="flex flex-col gap-4">
      {accounts.length > 1 && (
        <Tabs
          value={selected ?? accounts[0].id}
          onValueChange={setAccountId}
          tabs={accounts.map((a) => ({ value: a.id, label: a.displayName || a.username }))}
        />
      )}
      {selected && <AccountFeed accountId={selected} />}
    </div>
  );
}
