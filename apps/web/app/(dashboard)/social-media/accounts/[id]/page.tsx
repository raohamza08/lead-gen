"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../../lib/api-client";

interface Account {
  id: string;
  platform: string;
  username: string;
  displayName: string | null;
}

interface FeedItem {
  externalPostId: string;
  content: string;
  mediaUrl?: string;
  permalink?: string;
  postedAt: string;
  likeCount: number;
  commentCount: number;
  isOwnPost?: boolean;
}

const PLATFORM_HOME: Record<string, string> = {
  LINKEDIN: "https://www.linkedin.com/",
  TIKTOK: "https://www.tiktok.com/",
  YOUTUBE: "https://www.youtube.com/",
  X: "https://x.com/",
  FACEBOOK: "https://www.facebook.com/",
  INSTAGRAM: "https://www.instagram.com/",
};

function openInNewTabUrl(account: Account): string {
  if (account.platform === "X" && account.username.startsWith("@")) {
    return `https://x.com/${account.username.slice(1)}`;
  }
  return PLATFORM_HOME[account.platform] ?? "https://www.google.com/";
}

/** Not every platform has a real feed API (Part: Social Media Hub — see
 *  PlatformNotConfiguredError from the provider). Rather than branch on
 *  platform in the UI, this always attempts the real call and falls back
 *  to an honest message + a plain "open the real site" link on failure —
 *  correct automatically if a platform gains support later. */
function UnavailableFallback({ account, message }: { account: Account; message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-[var(--line)] px-6 py-10 text-center">
      <p className="text-sm text-ink/60">{message}</p>
      <a
        href={openInNewTabUrl(account)}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
      >
        Open {account.platform.charAt(0) + account.platform.slice(1).toLowerCase()} in a new tab
      </a>
    </div>
  );
}

/** DMs for this account live in the unified Social Inbox now (Part: Unified
 *  Social Media DM Monitoring) — this page used to also have a "Messages"
 *  tab with its own live-fetch-only conversation view, removed because it
 *  duplicated the persisted inbox with a second, divergent data source. */
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

  const feedQuery = useQuery({
    queryKey: ["social-media-feed", accountId],
    queryFn: () => api.getAccountFeed(accountId) as Promise<FeedItem[]>,
    enabled: Boolean(account),
  });
  const feed = feedQuery.data ?? null;
  const feedError = feedQuery.error ? (feedQuery.error as Error).message : null;

  if (accountError) {
    return <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">{accountError}</div>;
  }
  if (!account) return <p className="text-sm text-ink/50">Loading…</p>;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href={`/social-media/${account.platform.toLowerCase()}`} className="text-xs text-accent hover:underline">
          ← {account.platform.charAt(0) + account.platform.slice(1).toLowerCase()}
        </Link>
        <h1 className="mt-1 text-lg font-semibold tracking-tight">{account.displayName || account.username}</h1>
        {account.displayName && <p className="text-xs text-ink/50">{account.username}</p>}
        <Link href="/social-inbox" className="mt-1 inline-block text-xs text-accent hover:underline">
          View DMs for this account in the Social Inbox →
        </Link>
      </div>

      <h2 className="text-sm font-medium text-ink/70">Feed</h2>
      {feedError ? (
        <UnavailableFallback account={account} message={feedError} />
      ) : !feed ? (
        <p className="text-sm text-ink/50">Loading…</p>
      ) : feed.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink/50">No posts found on this account yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {feed.map((item) => (
            <div key={item.externalPostId} className="card flex flex-col gap-2 p-4">
              {item.mediaUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.mediaUrl} alt="" className="aspect-square w-full rounded-md object-cover" />
              )}
              <p className="line-clamp-3 text-sm">{item.content || <span className="text-ink/40">(no caption)</span>}</p>
              <div className="mt-auto flex items-center justify-between text-xs text-ink/50">
                <span>{new Date(item.postedAt).toLocaleDateString()}</span>
                <span>
                  ♥ {item.likeCount} · 💬 {item.commentCount}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {item.isOwnPost && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] text-accent">Published here</span>}
                {item.permalink && (
                  <a href={item.permalink} target="_blank" rel="noopener noreferrer" className="text-[11px] text-accent hover:underline">
                    View on {account.platform.toLowerCase()}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
