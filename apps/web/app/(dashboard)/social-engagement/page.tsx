"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api-client";
import { PostWithComments } from "../../../components/social-engagement/post-with-comments";
import { LoadingRow, Spinner } from "../../../components/spinner";

interface SocialAccountItem {
  id: string;
  platform: string;
  username: string;
  displayName: string | null;
  status: string;
}

interface PostGroup {
  accountId: string;
  account: { id: string; platform: string; username: string; displayName: string | null } | null;
  externalPostId: string;
  commentCount: number;
  unansweredCount: number;
  lastCommentAt: string;
}

interface Capabilities {
  comments: boolean;
  notes: string;
}

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function SocialEngagementPage() {
  return (
    <Suspense fallback={<LoadingRow />}>
      <SocialEngagementPageContent />
    </Suspense>
  );
}

function SocialEngagementPageContent() {
  const searchParams = useSearchParams();

  const [platformFilter, setPlatformFilter] = useState("");
  const [accountId, setAccountId] = useState("");
  const [unansweredOnly, setUnansweredOnly] = useState(false);
  const initialAccountId = searchParams?.get("accountId") ?? null;
  const initialPostId = searchParams?.get("postId") ?? null;
  const [selected, setSelected] = useState<{ accountId: string; postId: string } | null>(
    initialAccountId && initialPostId ? { accountId: initialAccountId, postId: initialPostId } : null,
  );

  const accountsQuery = useQuery({
    queryKey: ["social-engagement-accounts"],
    queryFn: () => api.getSocialAccounts() as Promise<SocialAccountItem[]>,
  });
  const capabilitiesQuery = useQuery({
    queryKey: ["social-engagement-capabilities"],
    queryFn: () => api.getSocialCapabilities() as Promise<Record<string, Capabilities>>,
  });
  const statsQuery = useQuery({
    queryKey: ["social-engagement-stats"],
    queryFn: () => api.getSocialEngagementStats() as Promise<{ total: number; unanswered: number; responded: number; ignored: number }>,
  });

  const postsQuery = useQuery({
    queryKey: ["social-engagement-posts", platformFilter, accountId, unansweredOnly],
    queryFn: () => {
      const params: Record<string, string> = {};
      if (platformFilter) params.platform = platformFilter;
      if (accountId) params.accountId = accountId;
      if (unansweredOnly) params.unansweredOnly = "true";
      return api.getSocialEngagementPosts(params) as Promise<PostGroup[]>;
    },
  });

  const accounts = accountsQuery.data ?? [];
  const posts = postsQuery.data ?? [];
  const commentablePlatforms = Array.from(
    new Set(accounts.filter((a) => capabilitiesQuery.data?.[a.platform]?.comments).map((a) => a.platform)),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">Engagement</h1>
          {postsQuery.isFetching && !postsQuery.isLoading && <Spinner className="h-3.5 w-3.5" />}
          {statsQuery.data && statsQuery.data.unanswered > 0 && (
            <span className="rounded-full bg-bad px-2 py-0.5 text-[11px] font-semibold text-white">{statsQuery.data.unanswered} unanswered</span>
          )}
        </div>
        <p className="text-xs text-ink/50">Comments on your own posts — synced every 10 minutes.</p>
      </div>
      {statsQuery.data && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink/55">
          <span>{statsQuery.data.total} comments</span>
          <span>{statsQuery.data.unanswered} unanswered</span>
          <span>{statsQuery.data.responded} responded</span>
          <span>{statsQuery.data.ignored} ignored</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[220px_360px_1fr]">
        {/* Filter sidebar */}
        <div className="card flex h-fit flex-col gap-4 p-4 lg:sticky lg:top-4">
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink/50">Platform</div>
            <div className="flex flex-col gap-1">
              <button
                onClick={() => setPlatformFilter("")}
                className={`rounded px-2 py-1 text-left text-xs ${platformFilter === "" ? "bg-accent font-medium text-white" : "hover:bg-ink/5"}`}
              >
                All platforms
              </button>
              {commentablePlatforms.map((p) => (
                <button
                  key={p}
                  onClick={() => setPlatformFilter(p)}
                  className={`rounded px-2 py-1 text-left text-xs ${platformFilter === p ? "bg-accent font-medium text-white" : "hover:bg-ink/5"}`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink/50">Account</div>
            <div className="flex flex-col gap-1">
              <button
                onClick={() => setAccountId("")}
                className={`rounded px-2 py-1 text-left text-xs ${accountId === "" ? "bg-accent font-medium text-white" : "hover:bg-ink/5"}`}
              >
                All accounts
              </button>
              {accounts
                .filter((a) => !platformFilter || a.platform === platformFilter)
                .filter((a) => capabilitiesQuery.data?.[a.platform]?.comments)
                .map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setAccountId(a.id)}
                    className={`rounded px-2 py-1 text-left text-xs ${accountId === a.id ? "bg-accent font-medium text-white" : "hover:bg-ink/5"}`}
                  >
                    {a.displayName || a.username}
                  </button>
                ))}
              {accounts.filter((a) => capabilitiesQuery.data?.[a.platform]?.comments).length === 0 && !accountsQuery.isLoading && (
                <span className="text-[11px] text-ink/40">No connected accounts support comments yet.</span>
              )}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-ink/70">
            <input type="checkbox" checked={unansweredOnly} onChange={(e) => setUnansweredOnly(e.target.checked)} />
            Unanswered only
          </label>
        </div>

        {/* Post list -- one row per post with comments, not one row per comment */}
        <div className="card flex h-fit flex-col overflow-hidden lg:max-h-[75vh]">
          <div className="flex-1 overflow-y-auto">
            {postsQuery.isLoading ? (
              <LoadingRow label="Loading posts…" />
            ) : posts.length === 0 ? (
              <p className="px-3 py-10 text-center text-xs text-ink/40">No commented-on posts match these filters.</p>
            ) : (
              posts.map((p) => (
                <button
                  key={`${p.accountId}:${p.externalPostId}`}
                  onClick={() => setSelected({ accountId: p.accountId, postId: p.externalPostId })}
                  className={`flex w-full flex-col gap-1 border-b border-[var(--line)] px-3 py-2.5 text-left last:border-0 hover:bg-ink/5 ${
                    selected?.accountId === p.accountId && selected?.postId === p.externalPostId ? "bg-accent/10" : ""
                  } ${p.unansweredCount > 0 ? "font-medium" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span>
                      {p.account?.platform} · @{p.account?.username}
                    </span>
                    <span className="shrink-0 text-[10px] font-normal text-ink/40">{timeAgo(p.lastCommentAt)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-normal text-ink/55">
                    <span>{p.commentCount} comment{p.commentCount === 1 ? "" : "s"}</span>
                    {p.unansweredCount > 0 && (
                      <span className="rounded-full bg-bad px-1.5 py-0 text-[10px] text-white">{p.unansweredCount} unanswered</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Detail panel -- the post, then its comments below it */}
        <div className="lg:max-h-[75vh]">
          {selected ? (
            <PostWithComments accountId={selected.accountId} externalPostId={selected.postId} capabilitiesByPlatform={capabilitiesQuery.data ?? {}} />
          ) : (
            <div className="card flex h-full min-h-[300px] items-center justify-center text-sm text-ink/40">
              Select a post to view its comments.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
