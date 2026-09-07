"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api-client";
import { LoadingRow, Spinner } from "../spinner";

interface Post {
  externalPostId: string;
  content: string;
  mediaUrl?: string;
  videoUrl?: string;
  mediaType?: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | "OTHER";
  permalink?: string;
  postedAt: string;
  likeCount: number;
  commentCount: number;
}

interface Comment {
  id: string;
  externalCommentId: string;
  authorName: string | null;
  authorProfileImageUrl: string | null;
  text: string | null;
  postedAt: string;
  fromUs: boolean;
  status: "NEW" | "RESPONDED" | "IGNORED";
  assignedToUser: { id: string; name: string } | null;
}

interface PostDetail {
  account: { id: string; platform: string; username: string; displayName: string | null };
  post: Post | null;
  comments: Comment[];
}

interface Capabilities {
  comments: boolean;
  likes: boolean;
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

const STATUS_TONE: Record<string, string> = {
  NEW: "bg-bad/15 text-bad",
  RESPONDED: "bg-good/15 text-good",
  IGNORED: "bg-ink/8 text-ink/50",
};

/** One inbound comment row + its own reply box, expanded in place -- not a
 *  separate page, since answering one comment out of a post's several is
 *  the common case and shouldn't require navigating away and back. */
function CommentRow({ comment, canReply, canLike, platformNote, onReplied }: { comment: Comment; canReply: boolean; canLike: boolean; platformNote?: string; onReplied: () => void }) {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [liked, setLiked] = useState(false);

  const replyMutation = useMutation({
    mutationFn: (t: string) => api.replySocialEngagementComment(comment.id, t),
    onSuccess: () => {
      setText("");
      setReplying(false);
      onReplied();
    },
    onError: (err) => setError((err as Error).message),
  });

  const likeMutation = useMutation({
    mutationFn: () => api.likeSocialEngagementComment(comment.id),
    onSuccess: () => setLiked(true),
    onError: (err) => setError((err as Error).message),
  });

  if (comment.fromUs) {
    // Our own reply, rendered as a nested, visually subordinate row -- not
    // a chat bubble, still a flat item in the same comment list, just
    // indented and accent-colored so "who said what" reads at a glance.
    return (
      <div className="ml-8 flex items-start gap-2 border-l-2 border-accent/40 py-2 pl-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="font-medium text-accent">You replied</span>
            <span className="text-ink/35">{timeAgo(comment.postedAt)}</span>
          </div>
          <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink/80">{comment.text}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5 border-b border-[var(--line)]/60 px-1 py-3 transition-colors last:border-0 hover:bg-ink/[0.03]">
      {comment.authorProfileImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={comment.authorProfileImageUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-[var(--line)]" />
      ) : (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink/10 text-[11px] font-medium text-ink/50">
          {(comment.authorName || "?").slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-medium">{comment.authorName || "Unknown"}</span>
          <span className="text-ink/35">{timeAgo(comment.postedAt)}</span>
          <span className={`rounded-full px-1.5 py-0 text-[10px] ${STATUS_TONE[comment.status] ?? ""}`}>{comment.status}</span>
          {comment.assignedToUser && <span className="text-ink/35">· Assigned: {comment.assignedToUser.name}</span>}
        </div>
        <p className="mt-0.5 whitespace-pre-wrap text-sm">{comment.text || <span className="text-ink/40">(no text)</span>}</p>

        {error && <p className="mt-1 text-xs text-bad">{error}</p>}

        {canLike && (
          <button
            onClick={() => likeMutation.mutate()}
            disabled={likeMutation.isPending || liked}
            className={`mt-1 mr-3 inline-flex items-center gap-1 text-xs hover:underline disabled:no-underline ${liked ? "text-accent" : "text-ink/50"}`}
          >
            {likeMutation.isPending && <Spinner className="h-3 w-3" />}
            {liked ? "Liked" : "Like"}
          </button>
        )}

        {canReply ? (
          replying ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) replyMutation.mutate(text.trim());
              }}
              className="mt-1.5 flex gap-1.5"
            >
              <input
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Write a reply…"
                className="flex-1 rounded border border-[var(--line)] bg-transparent px-2 py-1 text-xs"
              />
              <button
                type="submit"
                disabled={replyMutation.isPending || !text.trim()}
                className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs text-white disabled:opacity-50"
              >
                {replyMutation.isPending && <Spinner className="h-3 w-3" />}
                Send
              </button>
              <button type="button" onClick={() => setReplying(false)} className="text-xs text-ink/50 hover:underline">
                Cancel
              </button>
            </form>
          ) : (
            <button onClick={() => setReplying(true)} className="mt-1 text-xs text-accent hover:underline">
              Reply
            </button>
          )
        ) : (
          <p className="mt-1 text-[11px] text-ink/40" title={platformNote}>
            Replying not available for this platform.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The post, then every comment on it below (Part: Social Hub Engagement
 * post-centric redesign, 2026-09-07) — replaces a chat-bubble single-
 * comment thread with the layout a real comments section actually has:
 * the post's own content/media at the top, a flat chronological list of
 * every comment (and our own replies, visually subordinate, not bubbled)
 * underneath. Shared between the Engagement Center's detail panel and the
 * account feed page — one component, one behavior, everywhere a post's
 * comments are shown.
 */
export function PostWithComments({
  accountId,
  externalPostId,
  capabilitiesByPlatform,
  hidePostPreview,
}: {
  accountId: string;
  externalPostId: string;
  capabilitiesByPlatform: Record<string, Capabilities>;
  /** True when the caller already shows the post's own header/media/caption/
   *  like-button above this component (Part: account feed page's Instagram-
   *  style PostCard, 2026-09-07) -- repeating it here would just duplicate
   *  the same header and a second Like button right underneath the first. */
  hidePostPreview?: boolean;
}) {
  const queryClient = useQueryClient();
  const [postLiked, setPostLiked] = useState(false);
  const [postLikeError, setPostLikeError] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ["social-engagement-post", accountId, externalPostId],
    queryFn: () => api.getSocialEngagementPost(accountId, externalPostId) as Promise<PostDetail>,
  });

  const likePostMutation = useMutation({
    mutationFn: () => api.likeSocialFeedPost(accountId, externalPostId),
    onSuccess: () => setPostLiked(true),
    onError: (err) => setPostLikeError((err as Error).message),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["social-engagement-post", accountId, externalPostId] });
    queryClient.invalidateQueries({ queryKey: ["social-engagement-posts"] });
    queryClient.invalidateQueries({ queryKey: ["social-engagement-stats"] });
  }

  if (detailQuery.isLoading) {
    return (
      <div className="card flex h-full items-center justify-center">
        <LoadingRow label="Loading post…" />
      </div>
    );
  }

  const detail = detailQuery.data;
  if (!detail) {
    return <div className="card flex h-full items-center justify-center text-sm text-ink/50">Not found.</div>;
  }

  const { account, post, comments } = detail;
  const platformCaps = capabilitiesByPlatform[account.platform];
  const canReply = platformCaps?.comments ?? false;
  const canLike = platformCaps?.likes ?? false;

  return (
    <div className={`flex h-full flex-col overflow-hidden ${hidePostPreview ? "" : "card"}`}>
      {!hidePostPreview && (
      <div className="border-b border-[var(--line)] px-4 py-3.5">
        <div className="text-[11px] font-medium uppercase tracking-wide text-ink/45">
          {account.platform} · @{account.username}
        </div>

        {post ? (
          <div className="mt-2.5 flex gap-3.5">
            {(post.mediaUrl || post.videoUrl) &&
              (post.mediaType === "VIDEO" && post.videoUrl ? (
                <video src={post.videoUrl} poster={post.mediaUrl} controls className="h-28 w-28 shrink-0 rounded-lg bg-black object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={post.mediaUrl} alt="" className="h-28 w-28 shrink-0 rounded-lg object-cover" />
              ))}
            <div className="min-w-0 flex-1">
              <p className="line-clamp-4 whitespace-pre-wrap text-sm">{post.content || <span className="text-ink/40">(no caption)</span>}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-ink/45">
                <span>{new Date(post.postedAt).toLocaleDateString()}</span>
                <span>{post.likeCount} {post.likeCount === 1 ? "like" : "likes"}</span>
                <span>{post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}</span>
                {canLike && (
                  <button
                    onClick={() => likePostMutation.mutate()}
                    disabled={likePostMutation.isPending || postLiked}
                    className={`inline-flex items-center gap-1 font-medium hover:underline disabled:no-underline ${postLiked ? "text-accent" : "text-ink/60"}`}
                  >
                    {likePostMutation.isPending && <Spinner className="h-3 w-3" />}
                    {postLiked ? "Liked" : "Like"}
                  </button>
                )}
                {post.permalink && (
                  <a href={post.permalink} target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">
                    View on {account.platform.toLowerCase()}
                  </a>
                )}
              </div>
              {postLikeError && <p className="mt-1 text-[11px] text-bad">{postLikeError}</p>}
            </div>
          </div>
        ) : (
          <p className="mt-2 text-xs text-ink/40">
            This post is no longer in {account.platform}&apos;s recent feed, so its content can&apos;t be shown here — the comments below are still current.
          </p>
        )}
      </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-1">
        {comments.length === 0 ? (
          <p className="py-8 text-center text-xs text-ink/40">No comments on this post.</p>
        ) : (
          comments.map((c) => (
            <CommentRow key={c.id} comment={c} canReply={canReply} canLike={canLike} platformNote={platformCaps?.notes} onReplied={invalidate} />
          ))
        )}
      </div>
    </div>
  );
}
