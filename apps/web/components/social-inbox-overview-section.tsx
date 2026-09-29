"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "../lib/api-client";
import { StatTile } from "./chart-kit";

interface ConversationStats {
  total: number;
  unread: number;
  open: number;
  pending: number;
  closed: number;
}

interface CommentStats {
  total: number;
  unanswered: number;
  responded: number;
  ignored: number;
}

/** Social Inbox reporting tab (Part: Split dashboard reporting, 2026-09-29)
 *  — DMs/conversations (Social Inbox) and comments (Engagement Center) are
 *  two distinct queues on the backend (SocialInboxService/SocialEngagementService),
 *  so they get two stat rows rather than one merged count. */
export function SocialInboxOverviewSection() {
  const conversationsQuery = useQuery({
    queryKey: ["overview", "social-inbox-stats"],
    queryFn: () => api.getSocialInboxStats() as Promise<ConversationStats>,
  });
  const commentsQuery = useQuery({
    queryKey: ["overview", "social-engagement-stats"],
    queryFn: () => api.getSocialEngagementStats() as Promise<CommentStats>,
  });

  const conversations = conversationsQuery.data;
  const comments = commentsQuery.data;

  if (!conversations && !comments) {
    return <p className="py-10 text-center text-sm text-ink/45">Loading…</p>;
  }
  if ((conversations?.total ?? 0) === 0 && (comments?.total ?? 0) === 0) {
    return (
      <p className="py-10 text-center text-sm text-ink/45">
        No social conversations or comments synced yet.{" "}
        <Link href="/social-media/accounts" className="text-accent hover:underline">Connect an account</Link> to start.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {conversations && conversations.total > 0 && (
        <section className="card p-5">
          <h2 className="text-section-title text-ink">Direct messages</h2>
          <p className="mb-4 mt-0.5 text-xs text-ink/50">Every DM conversation across every connected account.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatTile label="Total" value={conversations.total} />
            <StatTile label="Unread" value={conversations.unread} tone={conversations.unread > 0 ? "gold" : undefined} />
            <StatTile label="Open" value={conversations.open} />
            <StatTile label="Pending" value={conversations.pending} />
            <StatTile label="Closed" value={conversations.closed} />
          </div>
          <Link href="/social-inbox" className="mt-3 inline-block text-xs text-accent hover:underline">
            Open Social Inbox →
          </Link>
        </section>
      )}

      {comments && comments.total > 0 && (
        <section className="card p-5">
          <h2 className="text-section-title text-ink">Comments</h2>
          <p className="mb-4 mt-0.5 text-xs text-ink/50">Comments on your posts across every connected account.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Total" value={comments.total} />
            <StatTile label="Unanswered" value={comments.unanswered} tone={comments.unanswered > 0 ? "gold" : undefined} />
            <StatTile label="Responded" value={comments.responded} tone="good" />
            <StatTile label="Ignored" value={comments.ignored} />
          </div>
          <Link href="/social-engagement" className="mt-3 inline-block text-xs text-accent hover:underline">
            Open Engagement Center →
          </Link>
        </section>
      )}
    </div>
  );
}
