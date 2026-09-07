"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api-client";
import { LoadingRow, Spinner } from "../spinner";

interface ReplyItem {
  id: string;
  text: string | null;
  postedAt: string;
}

interface CommentDetail {
  id: string;
  status: "NEW" | "RESPONDED" | "IGNORED";
  assignedToUserId: string | null;
  socialAccount: { id: string; platform: string; username: string; displayName: string | null };
  authorName: string | null;
  authorProfileImageUrl: string | null;
  text: string | null;
  postedAt: string;
  externalPostId: string;
  replies: ReplyItem[];
}

interface TeamUser {
  id: string;
  name: string;
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

/**
 * The right-hand column of the Engagement Center (Part: Social Hub
 * Engagement, 2026-09-07) — same structural role as
 * social-inbox/conversation-detail-panel.tsx, adapted for a comment thread
 * (a single top-level comment + our own replies to it, not an ongoing DM
 * exchange with unread state).
 */
export function CommentDetailPanel({ commentId, capabilitiesByPlatform }: { commentId: string; capabilitiesByPlatform: Record<string, Capabilities> }) {
  const queryClient = useQueryClient();
  const [replyText, setReplyText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ["social-engagement-comment", commentId],
    queryFn: () => api.getSocialEngagementComment(commentId) as Promise<CommentDetail>,
  });

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: () => api.getUsers() as Promise<TeamUser[]>,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["social-engagement-comment", commentId] });
    queryClient.invalidateQueries({ queryKey: ["social-engagement-comments"] });
    queryClient.invalidateQueries({ queryKey: ["social-engagement-stats"] });
  }

  const updateMutation = useMutation({
    mutationFn: (body: { status?: string; assignedToUserId?: string }) => api.updateSocialEngagementComment(commentId, body),
    onSuccess: invalidate,
    onError: (err) => setError((err as Error).message),
  });

  const replyMutation = useMutation({
    mutationFn: (text: string) => api.replySocialEngagementComment(commentId, text),
    onSuccess: () => {
      setReplyText("");
      invalidate();
    },
    onError: (err) => setError((err as Error).message),
  });

  if (detailQuery.isLoading) {
    return (
      <div className="card flex h-full items-center justify-center">
        <LoadingRow label="Loading comment…" />
      </div>
    );
  }

  const comment = detailQuery.data;
  if (!comment) {
    return <div className="card flex h-full items-center justify-center text-sm text-ink/50">Comment not found.</div>;
  }

  const platformCaps = capabilitiesByPlatform[comment.socialAccount.platform];
  const canReply = platformCaps?.comments ?? false;

  function submitReply(e: React.FormEvent) {
    e.preventDefault();
    if (!replyText.trim()) return;
    replyMutation.mutate(replyText.trim());
  }

  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
        <div>
          <div className="text-sm font-semibold">{comment.authorName || "Unknown"}</div>
          <div className="text-xs text-ink/50">
            {comment.socialAccount.platform} · @{comment.socialAccount.username}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={comment.status}
            onChange={(e) => updateMutation.mutate({ status: e.target.value })}
            disabled={updateMutation.isPending}
            className="rounded border border-[var(--line)] bg-transparent px-2 py-1 text-xs"
          >
            <option value="NEW">New</option>
            <option value="RESPONDED">Responded</option>
            <option value="IGNORED">Ignored</option>
          </select>
          <select
            value={comment.assignedToUserId ?? ""}
            onChange={(e) => updateMutation.mutate({ assignedToUserId: e.target.value })}
            disabled={updateMutation.isPending}
            className="rounded border border-[var(--line)] bg-transparent px-2 py-1 text-xs"
          >
            <option value="">Unassigned</option>
            {(usersQuery.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-2 rounded border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-1.5 text-xs text-bad">
          {error}
        </div>
      )}

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        <div className="max-w-[85%] rounded-lg border border-[var(--line)] px-3 py-2 text-sm">
          <div className="whitespace-pre-wrap">{comment.text || "(no text)"}</div>
          <div className="mt-1 text-[10px] text-ink/40">{timeAgo(comment.postedAt)}</div>
        </div>
        {comment.replies.map((r) => (
          <div key={r.id} className="ml-6 flex justify-end">
            <div className="max-w-[75%] rounded-lg bg-accent px-3 py-2 text-sm text-white">
              <div className="whitespace-pre-wrap">{r.text}</div>
              <div className="mt-1 text-[10px] text-white/70">{timeAgo(r.postedAt)}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Reply box — disabled with an explanation when the platform's
          official API doesn't support replying (same "never a workaround"
          rule as the Social Inbox reply box). */}
      <div className="border-t border-[var(--line)] px-4 py-3">
        {canReply ? (
          <form onSubmit={submitReply} className="flex gap-2">
            <input
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Type a reply…"
              className="flex-1 rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={replyMutation.isPending || !replyText.trim()}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs text-white disabled:opacity-50"
            >
              {replyMutation.isPending && <Spinner className="h-3 w-3" />}
              Reply
            </button>
          </form>
        ) : (
          <p className="text-xs text-ink/45">
            Replying isn&apos;t available here: {platformCaps?.notes || `${comment.socialAccount.platform}'s official API doesn't support replying to comments.`}
          </p>
        )}
      </div>
    </div>
  );
}
