"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { Spinner } from "../../../../components/spinner";

const STATUSES = ["ALL", "DRAFT", "PENDING_REVIEW", "APPROVED", "SCHEDULED", "PUBLISHED", "FAILED", "REJECTED"] as const;
type Status = (typeof STATUSES)[number];

interface PostVersion {
  id: string;
  accountId: string;
  content: string;
  hashtags: string[];
  publishedAt: string | null;
  publishError: string | null;
  account: { platform: string; username: string; displayName: string | null };
}

interface Post {
  id: string;
  status: Exclude<Status, "ALL">;
  scheduledAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  versions: PostVersion[];
}

function StatusBadge({ status }: { status: Post["status"] }) {
  const tone =
    status === "PUBLISHED" ? "bg-good/15 text-good"
    : status === "FAILED" || status === "REJECTED" ? "bg-bad/15 text-bad"
    : status === "PENDING_REVIEW" ? "bg-gold/15 text-gold"
    : "bg-ink/8 text-ink/55";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${tone}`}>{status.replace("_", " ")}</span>;
}

/**
 * Posts list with status tabs (Part: Draft / Scheduled / Published lists) and
 * the approval workflow actions (Part: Approval Workflow) — every action here
 * maps to exactly one SocialMediaService method, no client-side state machine
 * duplicating the backend's transition rules.
 */
export default function PostsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialStatus = (searchParams?.get("status") as Status) ?? "ALL";
  const [status, setStatus] = useState<Status>(STATUSES.includes(initialStatus) ? initialStatus : "ALL");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const postsQuery = useQuery({
    queryKey: ["social-media-posts", status],
    queryFn: async () => {
      const res = await api.getSocialPosts(status === "ALL" ? {} : { status });
      return (res as { posts: Post[] }).posts;
    },
  });
  const posts = postsQuery.data ?? [];

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["social-media-posts"] });
  }

  function selectStatus(s: Status) {
    setStatus(s);
    router.replace(s === "ALL" ? "/social-media/posts" : `/social-media/posts?status=${s}`);
  }

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">Posts</h1>
          {postsQuery.isFetching && !postsQuery.isLoading && <Spinner className="h-3.5 w-3.5" />}
        </div>
        <p className="mt-0.5 text-xs text-ink/50">Every post, at whatever stage it&apos;s in.</p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--line)] p-1">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => selectStatus(s)}
            aria-pressed={status === s}
            className={`rounded-md px-3 py-1 text-xs transition-colors ${status === s ? "bg-ink/10 font-medium text-ink" : "text-ink/60 hover:bg-ink/5"}`}
          >
            {s.replace("_", " ")}
          </button>
        ))}
      </div>

      {(error || postsQuery.error) && (
        <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
          {error ?? (postsQuery.error as Error).message}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {posts.map((post) => (
          <div key={post.id} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <StatusBadge status={post.status} />
                {post.scheduledAt && (
                  <span className="text-xs text-ink/50">{new Date(post.scheduledAt).toLocaleString()}</span>
                )}
              </div>
              <div className="flex gap-2">
                {post.status === "DRAFT" && (
                  <button
                    disabled={busyId === post.id}
                    onClick={() => act(post.id, () => api.submitSocialPost(post.id))}
                    className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 hover:bg-ink/5 disabled:opacity-50"
                  >
                    Submit
                  </button>
                )}
                {post.status === "PENDING_REVIEW" && (
                  <>
                    <button
                      disabled={busyId === post.id}
                      onClick={() => act(post.id, () => api.approveSocialPost(post.id))}
                      className="rounded-md bg-good px-2.5 py-1 text-xs text-white disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      disabled={busyId === post.id}
                      onClick={() => {
                        const reason = window.prompt("Reason for rejecting this post?");
                        if (reason) act(post.id, () => api.rejectSocialPost(post.id, reason));
                      }}
                      className="rounded-md border border-bad px-2.5 py-1 text-xs text-bad hover:bg-bad/5 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </>
                )}
                {post.status === "APPROVED" && (
                  <button
                    disabled={busyId === post.id}
                    onClick={() => {
                      const when = post.scheduledAt ? undefined : window.prompt("Schedule for when? (YYYY-MM-DDTHH:mm)");
                      if (post.scheduledAt || when) act(post.id, () => api.scheduleSocialPost(post.id, when ?? undefined));
                    }}
                    className="rounded-md bg-accent px-2.5 py-1 text-xs text-white disabled:opacity-50"
                  >
                    Schedule
                  </button>
                )}
                {post.status === "SCHEDULED" && (
                  <button
                    disabled={busyId === post.id}
                    onClick={() => act(post.id, () => api.unscheduleSocialPost(post.id))}
                    className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 hover:bg-ink/5 disabled:opacity-50"
                  >
                    Unschedule
                  </button>
                )}
                {post.status === "FAILED" && (
                  <button
                    disabled={busyId === post.id}
                    onClick={() => act(post.id, () => api.retrySocialPost(post.id))}
                    className="rounded-md bg-accent px-2.5 py-1 text-xs text-white disabled:opacity-50"
                  >
                    Retry
                  </button>
                )}
                {(post.status === "DRAFT" || post.status === "REJECTED") && (
                  <button
                    disabled={busyId === post.id}
                    onClick={() => {
                      if (confirm("Delete this post?")) act(post.id, () => api.deleteSocialPost(post.id));
                    }}
                    className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/50 hover:bg-ink/5 disabled:opacity-50"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>

            {post.rejectionReason && (
              <p className="mt-2 rounded bg-bad/5 px-2 py-1 text-xs text-bad">Rejected: {post.rejectionReason}</p>
            )}

            <div className="mt-3 flex flex-col gap-2">
              {post.versions.map((v) => (
                <div key={v.id} className="rounded-lg border border-[var(--line)] p-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-ink/70">
                      {v.account.platform} — {v.account.displayName || v.account.username}
                    </span>
                    {v.publishError && <span className="text-bad" title={v.publishError}>Failed: {v.publishError.slice(0, 60)}</span>}
                    {v.publishedAt && <span className="text-good">Published {new Date(v.publishedAt).toLocaleString()}</span>}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink/85">{v.content}</p>
                  {v.hashtags.length > 0 && <p className="mt-1 text-xs text-accent">{v.hashtags.join(" ")}</p>}
                </div>
              ))}
            </div>
          </div>
        ))}
        {posts.length === 0 && <p className="py-8 text-center text-sm text-ink/50">No posts in this view.</p>}
      </div>
    </div>
  );
}
