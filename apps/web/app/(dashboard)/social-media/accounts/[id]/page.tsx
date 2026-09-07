"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../../../../../lib/api-client";
import { PostWithComments } from "../../../../../components/social-engagement/post-with-comments";
import { Spinner } from "../../../../../components/spinner";

interface Account {
  id: string;
  platform: string;
  username: string;
  displayName: string | null;
  profileImageUrl: string | null;
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
  likes: boolean;
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

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={filled ? 0 : 1.8}>
      <path d="M12 21s-6.7-4.35-9.3-8.1C.8 10.1 1.4 6.6 4.3 5c2.3-1.3 5-.6 6.7 1.4l1 1.2 1-1.2c1.7-2 4.4-2.7 6.7-1.4 2.9 1.6 3.5 5.1 1.6 7.9C18.7 16.65 12 21 12 21z" strokeLinejoin="round" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.3-.67L3 21l1.67-6.2A8.5 8.5 0 1 1 21 11.5z" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[20px] w-[20px]" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M22 3 11 14M22 3l-7 18-4-8-8-4 19-6z" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function AccountAvatar({ account, size = 32 }: { account: Account; size?: number }) {
  const initial = (account.displayName || account.username || account.platform).replace(/^@/, "").slice(0, 1).toUpperCase();
  if (account.profileImageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={account.profileImageUrl}
        alt=""
        style={{ height: size, width: size }}
        className="shrink-0 rounded-full object-cover ring-1 ring-[var(--line)]"
      />
    );
  }
  return (
    <div
      style={{ height: size, width: size }}
      className="flex shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent"
    >
      {initial}
    </div>
  );
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
 * One post, styled after Instagram's own post card (Part: Social Media Hub
 * feed polish, 2026-09-07) — avatar + username header, full-bleed square
 * media, an icon action bar, then like count and caption below it, the
 * same visual language across every platform rather than the old compact
 * thumbnail-plus-text row. Comments still expand in place underneath via
 * the same PostWithComments component the Engagement Center uses, so
 * "click a platform and do everything from the feed" still holds.
 */
function PostCard({ account, item, capabilitiesByPlatform }: { account: Account; item: FeedItem; capabilitiesByPlatform: Record<string, Capabilities> }) {
  const [expanded, setExpanded] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likeError, setLikeError] = useState<string | null>(null);
  const canShowComments = capabilitiesByPlatform[account.platform]?.comments ?? false;
  const canLike = capabilitiesByPlatform[account.platform]?.likes ?? false;

  const likeMutation = useMutation({
    mutationFn: () => api.likeSocialFeedPost(account.id, item.externalPostId),
    onSuccess: () => setLiked(true),
    onError: (err) => setLikeError((err as Error).message),
  });

  return (
    <div className="card overflow-hidden !p-0">
      <div className="flex items-center gap-2.5 px-3.5 py-3">
        <AccountAvatar account={account} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{account.displayName || account.username}</div>
        </div>
        {item.isOwnPost && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-medium text-accent">Published here</span>}
      </div>

      {item.mediaUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.mediaUrl} alt="" className="aspect-square w-full bg-ink/5 object-cover" />
      )}

      <div className="flex items-center gap-3.5 px-3.5 pt-2.5 text-ink/80">
        <button
          onClick={() => canLike && likeMutation.mutate()}
          disabled={!canLike || likeMutation.isPending || liked}
          title={canLike ? undefined : "Liking not available for this platform"}
          className={`transition-transform active:scale-90 disabled:cursor-default ${liked ? "text-bad" : canLike ? "hover:text-ink" : "text-ink/25"}`}
        >
          <HeartIcon filled={liked} />
        </button>
        <button
          onClick={() => canShowComments && setExpanded((v) => !v)}
          disabled={!canShowComments}
          title={canShowComments ? undefined : "Comments not available for this platform"}
          className={`disabled:cursor-default ${canShowComments ? "hover:text-ink" : "text-ink/25"}`}
        >
          <CommentIcon />
        </button>
        {item.permalink && (
          <a href={item.permalink} target="_blank" rel="noopener noreferrer" title={`View on ${account.platform.toLowerCase()}`} className="hover:text-ink">
            <ShareIcon />
          </a>
        )}
      </div>
      {likeError && <p className="px-3.5 pt-1 text-xs text-bad">{likeError}</p>}

      <div className="px-3.5 pb-3.5 pt-1.5">
        <p className="text-sm font-semibold">{item.likeCount} {item.likeCount === 1 ? "like" : "likes"}</p>
        {item.content && (
          <p className="mt-0.5 whitespace-pre-wrap text-sm">
            <span className="font-semibold">{account.displayName || account.username}</span> {item.content}
          </p>
        )}
        {canShowComments && (
          <button onClick={() => setExpanded((v) => !v)} className="mt-1 block text-xs text-ink/45 hover:text-ink/70">
            {expanded ? "Hide comments" : item.commentCount > 0 ? `View all ${item.commentCount} comment${item.commentCount === 1 ? "" : "s"}` : "View comments"}
          </button>
        )}
        <p className="mt-1.5 text-[11px] uppercase tracking-wide text-ink/35">{new Date(item.postedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</p>
      </div>

      {expanded && (
        <div className="border-t border-[var(--line)]">
          <PostWithComments accountId={account.id} externalPostId={item.externalPostId} capabilitiesByPlatform={capabilitiesByPlatform} hidePostPreview />
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
        <div className="mt-2 flex items-center gap-3">
          <AccountAvatar account={account} size={56} />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{account.displayName || account.username}</h1>
            {account.displayName && <p className="text-xs text-ink/50">{account.username}</p>}
          </div>
        </div>
        <Link href="/social-inbox" className="mt-2 inline-block text-xs text-accent hover:underline">
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
        <div className="mx-auto flex w-full max-w-[470px] flex-col gap-5">
          {feed.map((item) => (
            <PostCard key={item.externalPostId} account={account} item={item} capabilitiesByPlatform={capabilitiesQuery.data ?? {}} />
          ))}
        </div>
      )}
    </div>
  );
}
