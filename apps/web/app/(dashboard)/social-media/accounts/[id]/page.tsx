"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../../lib/api-client";
import { Avatar } from "../../../../../components/ui/avatar";
import { AccountFeed } from "../../../../../components/social-media/account-feed";

interface Account {
  id: string;
  platform: string;
  username: string;
  displayName: string | null;
  profileImageUrl: string | null;
}

interface Capabilities {
  dms: boolean;
}

/** DMs for this account live in that platform's own page now (Part: Social
 *  Inbox removal / per-module messaging, 2026-10-21 — replaces the old
 *  centralized /social-inbox; before that, this page itself briefly had a
 *  "Messages" tab, removed because it duplicated the persisted inbox with a
 *  second, divergent data source — same reasoning still applies, which is
 *  why this links OUT to the platform page's Inbox tab rather than
 *  re-embedding a second conversation view here). The feed itself is
 *  extracted into AccountFeed (Part: same change) so the exact same feed
 *  renders here AND inside the platform page's own Feed tab — one
 *  implementation, not a second copy. */
export default function SocialAccountDetailPage() {
  const params = useParams<{ id: string }>();
  const accountId = params.id;

  // Same query key as /social-media/accounts — a visit from that list page
  // shows this account instantly from cache instead of refetching.
  const accountsQuery = useQuery({
    queryKey: ["social-media-accounts"],
    queryFn: () => api.getSocialAccounts() as Promise<Account[]>,
  });
  const account = accountsQuery.data?.find((a) => a.id === accountId) ?? null;
  const accountError = accountsQuery.error
    ? (accountsQuery.error as Error).message
    : accountsQuery.data && !account
      ? "Account not found"
      : null;

  const capabilitiesQuery = useQuery({
    queryKey: ["social-media-capabilities"],
    queryFn: () => api.getSocialCapabilities() as Promise<Record<string, Capabilities>>,
  });
  const hasInbox = account ? (capabilitiesQuery.data?.[account.platform]?.dms ?? false) : false;

  if (accountError) {
    return <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">{accountError}</div>;
  }
  if (!account) return <p className="text-sm text-ink/50">Loading…</p>;

  const platformLower = account.platform.toLowerCase();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href={`/social-media/${platformLower}`} className="text-xs text-accent hover:underline">
          ← {account.platform.charAt(0) + account.platform.slice(1).toLowerCase()}
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <Avatar name={account.displayName || account.username} imageUrl={account.profileImageUrl} size={56} />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{account.displayName || account.username}</h1>
            {account.displayName && <p className="text-xs text-ink/50">{account.username}</p>}
          </div>
        </div>
        {hasInbox && (
          <Link href={`/social-media/${platformLower}?tab=inbox&accountId=${account.id}`} className="mt-2 inline-block text-xs text-accent hover:underline">
            View DMs for this account →
          </Link>
        )}
      </div>

      <h2 className="text-sm font-medium text-ink/70">Feed</h2>
      <AccountFeed accountId={account.id} />
    </div>
  );
}
