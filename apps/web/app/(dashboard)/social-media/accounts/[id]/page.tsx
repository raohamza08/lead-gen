"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../../lib/api-client";
import { PostWithComments } from "../../../../../components/social-engagement/post-with-comments";

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

interface Capabilities {
  comments: boolean;
  notes: string;
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

/**
 * One post: content/media, stats, and — expandable, not a separate page —
 * its real comments below it via the same PostWithComments component the
 * Engagement Center uses (Part: Social Hub Engagement post-centric
 * redesign, 2026-09-07). This is the "click LinkedIn/Instagram and do
 * everything from the feed" surface: no detour through a different module
 * to read or answer what people said about a post.
 */
function PostCard({ account, item, capabilitiesByPlatform }: { account: Account; item: FeedItem; capabilitiesByPlatform: Record<string, Capabilities> }) {
  const [expanded, setExpanded] = useState(false);
  const canShowComments = capabilitiesByPlatform[account.platform]?.comments ?? false;

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-col gap-2 p-4 sm:flex-row">
        {item.mediaUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.mediaUrl} alt="" className="h-32 w-full shrink-0 rounded-md object-cover sm:w-32" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="whitespace-pre-wrap text-sm">{item.content || <span className="text-ink/40">(no caption)</span>}</p>
          <div className="mt-auto flex flex-wrap items-center gap-3 text-xs text-ink/50">
            <span>{new Date(item.postedAt).toLocaleDateString()}</span>
            <span>♥ {item.likeCount} · 💬 {item.commentCount}</span>
            {item.isOwnPost && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] text-accent">Published here</span>}
            {item.permalink && (
              <a href={item.permalink} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                View on {account.platform.toLowerCase()}
              </a>
            )}
            {canShowComments && (
              <button onClick={() => setExpanded((v) => !v)} className="ml-auto text-accent hover:underline">
                {expanded ? "Hide comments" : item.commentCount > 0 ? `View ${item.commentCount} comment${item.commentCount === 1 ? "" : "s"}` : "View comments"}
              </button>
            )}
          </div>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-[var(--line)]">
          <PostWithComments accountId={account.id} externalPostId={item.externalPostId} capabilitiesByPlatform={capabilitiesByPlatform} />
        </div>
      )}
    </div>
  );
}

/** DMs for this account live in the unified Social Inbox now (Part: Unified
 *  Social Media DM Monitoring) — this page used to also have a "Messages"
 *  tab with its own live-fetch-only conversation view, removed because it
 *  duplicated the persisted inbox with a second, divergent data source.
 *  Comments on each post are shown inline via PostCard/PostWithComments
 *  above, so "feed + engagement, one place" holds for comments too. */
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

  const capabilitiesQuery = useQuery({
    queryKey: ["social-media-capabilities"],
    queryFn: () => api.getSocialCapabilities() as Promise<Record<string, Capabilities>>,
  });

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
        <div className="flex flex-col gap-3">
          {feed.map((item) => (
            <PostCard key={item.externalPostId} account={account} item={item} capabilitiesByPlatform={capabilitiesQuery.data ?? {}} />
          ))}
        </div>
      )}
    </div>
  );
}
