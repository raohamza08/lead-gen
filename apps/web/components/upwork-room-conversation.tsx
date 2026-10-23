"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api-client";

export function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d`;
  return new Date(iso).toLocaleDateString();
}

/** Real conversation thread for a room (Part: Rooms & Messages chat
 *  history, 2026-10-23, explicit user request — real message history,
 *  left/right by sender, freelancer name shown; shared out 2026-10-23 so
 *  Delayed Responses can use the exact same conversation view — "update
 *  the delayed responses tab same like the rooms messages tab"). Fetches
 *  on mount/roomId change; the backend fetches live from Upwork right
 *  away if nothing's cached yet for this room ("when a chat is opened
 *  from below and it doesn't have any of its communication, the api
 *  should fetch the recent communication right away"). Client messages
 *  (left, neutral) vs agency/freelancer messages (right, accent) are
 *  distinguished by `senderIsAgency` — a best-effort heuristic computed
 *  server-side (see UpworkRoomsSyncService.isSenderAgencySide's own
 *  docblock) since Upwork gives no explicit "which side" field; the
 *  real sender name is always shown regardless, so a wrong guess on
 *  side never hides who actually said what. */
export function ConversationThread({ roomId, className = "max-h-[480px]" }: { roomId: string; className?: string }) {
  const messagesQuery = useQuery({
    queryKey: ["upwork-api-room-messages", roomId],
    queryFn: () => api.getUpworkApiRoomMessages(roomId),
  });
  const messages = messagesQuery.data?.messages ?? [];
  const scrollRef = useRef<HTMLDivElement>(null);

  // Opens on the latest message, not scrolled to the top of a long history
  // (explicit user report, 2026-10-23: "ensure when a chat is opened, it
  // opens with the latest msg not in the middle of the chat") — re-runs on
  // every roomId/message-count change so switching rooms or a freshly
  // fetched history both land at the bottom, not just the first mount.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [roomId, messages.length]);

  if (messagesQuery.isLoading) return <p className="text-sm text-ink/50">Loading conversation…</p>;
  if (messagesQuery.error) return <p className="text-sm text-bad">{(messagesQuery.error as Error).message}</p>;
  if (messages.length === 0) return <p className="text-sm text-ink/50">No messages found for this room.</p>;

  return (
    <div ref={scrollRef} className={`flex flex-col gap-2.5 overflow-y-auto ${className}`}>
      {messages.map((m) => (
        <div key={m.id} className={`flex flex-col gap-0.5 ${m.senderIsAgency ? "items-end" : "items-start"}`}>
          <div
            className={`max-w-[80%] overflow-hidden rounded-xl px-3.5 py-2.5 text-sm break-words whitespace-pre-wrap ${
              m.senderIsAgency ? "rounded-tr-sm bg-accent text-white" : "rounded-tl-sm bg-ink/[0.06] text-ink"
            }`}
          >
            {m.message || <span className="italic opacity-60">(no text)</span>}
          </div>
          <p className="px-1 text-[11px] text-ink/40">
            {m.senderName ?? "Unknown"}
            {m.senderIsAgency ? " (freelancer)" : " (client)"} · {new Date(m.createdAt).toLocaleString()}
          </p>
        </div>
      ))}
    </div>
  );
}
