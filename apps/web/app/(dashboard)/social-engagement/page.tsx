"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../lib/api-client";
import { CommentDetailPanel } from "../../../components/social-engagement/comment-detail-panel";
import { LoadingRow, Spinner } from "../../../components/spinner";

interface SocialAccountItem {
  id: string;
  platform: string;
  username: string;
  displayName: string | null;
  status: string;
}

interface CommentListItem {
  id: string;
  authorName: string | null;
  text: string | null;
  postedAt: string;
  status: "NEW" | "RESPONDED" | "IGNORED";
  socialAccount: { id: string; platform: string; username: string; displayName: string | null };
  assignedToUser: { id: string; name: string } | null;
}

interface Capabilities {
  comments: boolean;
  notes: string;
}

const PAGE_SIZE = 25;
const STATUS_TONE: Record<string, string> = {
  NEW: "bg-bad/15 text-bad",
  RESPONDED: "bg-good/15 text-good",
  IGNORED: "bg-ink/8 text-ink/50",
};

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
  const queryClient = useQueryClient();

  const [platformFilter, setPlatformFilter] = useState("");
  const [accountId, setAccountId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [unansweredOnly, setUnansweredOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams?.get("commentId") ?? null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const commentsQuery = useQuery({
    queryKey: ["social-engagement-comments", platformFilter, accountId, statusFilter, unansweredOnly, search, page],
    queryFn: () => {
      const params: Record<string, string> = { page: String(page), pageSize: String(PAGE_SIZE) };
      if (platformFilter) params.platform = platformFilter;
      if (accountId) params.accountId = accountId;
      if (statusFilter) params.status = statusFilter;
      if (unansweredOnly) params.unansweredOnly = "true";
      if (search.trim()) params.search = search.trim();
      return api.getSocialEngagementComments(params) as Promise<{ comments: CommentListItem[]; total: number }>;
    },
  });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["social-engagement-comments"] });
    queryClient.invalidateQueries({ queryKey: ["social-engagement-stats"] });
  }

  const accounts = accountsQuery.data ?? [];
  const comments = commentsQuery.data?.comments ?? [];
  const total = commentsQuery.data?.total ?? 0;
  // Only accounts whose provider actually implements comment reading get a
  // useful platform filter option -- capabilities.comments is what the
  // backend itself gates listComments()/replyToComment() on.
  const commentablePlatforms = Array.from(
    new Set(accounts.filter((a) => capabilitiesQuery.data?.[a.platform]?.comments).map((a) => a.platform)),
  );

  function resetPage<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

  async function syncNow(id: string) {
    setSyncingId(id);
    setError(null);
    try {
      await api.syncSocialEngagementAccountNow(id);
      invalidateAll();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSyncingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">Engagement</h1>
          {commentsQuery.isFetching && !commentsQuery.isLoading && <Spinner className="h-3.5 w-3.5" />}
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
      {error && <p className="text-sm text-bad">{error}</p>}
      <div className="flex justify-end">
        <input
          value={search}
          onChange={(e) => resetPage(setSearch)(e.target.value)}
          placeholder="Search author, comment, account…"
          className="min-w-[260px] rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[220px_360px_1fr]">
        {/* Filter sidebar */}
        <div className="card flex h-fit flex-col gap-4 p-4 lg:sticky lg:top-4">
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink/50">Platform</div>
            <div className="flex flex-col gap-1">
              <button
                onClick={() => resetPage(setPlatformFilter)("")}
                className={`rounded px-2 py-1 text-left text-xs ${platformFilter === "" ? "bg-accent font-medium text-white" : "hover:bg-ink/5"}`}
              >
                All platforms
              </button>
              {commentablePlatforms.map((p) => (
                <button
                  key={p}
                  onClick={() => resetPage(setPlatformFilter)(p)}
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
                onClick={() => resetPage(setAccountId)("")}
                className={`rounded px-2 py-1 text-left text-xs ${accountId === "" ? "bg-accent font-medium text-white" : "hover:bg-ink/5"}`}
              >
                All accounts
              </button>
              {accounts
                .filter((a) => !platformFilter || a.platform === platformFilter)
                .filter((a) => capabilitiesQuery.data?.[a.platform]?.comments)
                .map((a) => (
                  <div key={a.id} className="flex items-center gap-1">
                    <button
                      onClick={() => resetPage(setAccountId)(a.id)}
                      className={`flex-1 rounded px-2 py-1 text-left text-xs ${accountId === a.id ? "bg-accent font-medium text-white" : "hover:bg-ink/5"}`}
                    >
                      {a.displayName || a.username}
                    </button>
                    <button
                      onClick={() => syncNow(a.id)}
                      disabled={syncingId === a.id}
                      title="Sync comments now"
                      className="shrink-0 rounded px-1.5 py-1 text-[11px] text-ink/40 hover:bg-ink/5 hover:text-ink disabled:opacity-40"
                    >
                      {syncingId === a.id ? "…" : "↻"}
                    </button>
                  </div>
                ))}
              {accounts.filter((a) => capabilitiesQuery.data?.[a.platform]?.comments).length === 0 && !accountsQuery.isLoading && (
                <span className="text-[11px] text-ink/40">No connected accounts support comments yet.</span>
              )}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink/50">Status</div>
            <div className="flex flex-col gap-1">
              {["", "NEW", "RESPONDED", "IGNORED"].map((s) => (
                <button
                  key={s || "all"}
                  onClick={() => resetPage(setStatusFilter)(s)}
                  className={`rounded px-2 py-1 text-left text-xs ${statusFilter === s ? "bg-accent font-medium text-white" : "hover:bg-ink/5"}`}
                >
                  {s === "" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-ink/70">
            <input type="checkbox" checked={unansweredOnly} onChange={(e) => resetPage(setUnansweredOnly)(e.target.checked)} />
            Unanswered only
          </label>
        </div>

        {/* Comment list */}
        <div className="card flex h-fit flex-col overflow-hidden lg:max-h-[75vh]">
          <div className="flex-1 overflow-y-auto">
            {commentsQuery.isLoading ? (
              <LoadingRow label="Loading comments…" />
            ) : comments.length === 0 ? (
              <p className="px-3 py-10 text-center text-xs text-ink/40">No comments match these filters.</p>
            ) : (
              comments.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`flex w-full flex-col gap-1 border-b border-[var(--line)] px-3 py-2.5 text-left last:border-0 hover:bg-ink/5 ${
                    selectedId === c.id ? "bg-accent/10" : ""
                  } ${c.status === "NEW" ? "font-medium" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm">{c.authorName || "Unknown"}</span>
                    <span className="shrink-0 text-[10px] font-normal text-ink/40">{timeAgo(c.postedAt)}</span>
                  </div>
                  <div className="line-clamp-1 text-xs font-normal text-ink/55">{c.text || "—"}</div>
                  <div className="flex items-center justify-between gap-2 text-[10px] font-normal text-ink/45">
                    <span>
                      {c.socialAccount.platform} · @{c.socialAccount.username}
                    </span>
                    <span className={`rounded-full px-1.5 py-0 ${STATUS_TONE[c.status] ?? ""}`}>{c.status}</span>
                  </div>
                  {c.assignedToUser && <div className="text-[10px] font-normal text-ink/40">Assigned: {c.assignedToUser.name}</div>}
                </button>
              ))
            )}
          </div>
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-[var(--line)] px-3 py-2 text-xs text-ink/50">
              <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="disabled:opacity-30">
                ← Prev
              </button>
              <span>
                Page {page} of {Math.ceil(total / PAGE_SIZE)}
              </span>
              <button disabled={page * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)} className="disabled:opacity-30">
                Next →
              </button>
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="lg:max-h-[75vh]">
          {selectedId ? (
            <CommentDetailPanel commentId={selectedId} capabilitiesByPlatform={capabilitiesQuery.data ?? {}} />
          ) : (
            <div className="card flex h-full min-h-[300px] items-center justify-center text-sm text-ink/40">
              Select a comment to view it.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
