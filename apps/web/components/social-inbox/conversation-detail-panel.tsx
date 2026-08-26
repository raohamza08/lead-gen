"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api-client";
import { LoadingRow, Spinner } from "../spinner";

interface SocialMessageItem {
  id: string;
  fromUs: boolean;
  senderName: string | null;
  messageText: string | null;
  mediaUrl: string | null;
  sentAt: string;
}

interface SocialNoteItem {
  id: string;
  note: string;
  createdAt: string;
  user: { id: string; name: string };
}

interface ConversationDetail {
  id: string;
  status: "OPEN" | "PENDING" | "CLOSED";
  assignedToUserId: string | null;
  socialAccount: { id: string; platform: string; username: string; displayName: string | null };
  contactName: string | null;
  contactUsername: string | null;
  messages: SocialMessageItem[];
  notes: SocialNoteItem[];
}

interface TeamUser {
  id: string;
  name: string;
}

interface Capabilities {
  dms: boolean;
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
 * The right-hand column of the Social Inbox (Part: Unified Social Media DM
 * Monitoring — conversation detail). Internal notes render in a visually
 * distinct card, never inside the message thread, and are never sent
 * anywhere — POST/PATCH/DELETE here only ever hit social-inbox/notes
 * endpoints, never a provider's sendMessage.
 */
export function ConversationDetailPanel({ conversationId, capabilitiesByPlatform }: { conversationId: string; capabilitiesByPlatform: Record<string, Capabilities> }) {
  const queryClient = useQueryClient();
  const [replyText, setReplyText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ["social-inbox-conversation", conversationId],
    queryFn: () => api.getSocialInboxConversation(conversationId) as Promise<ConversationDetail>,
  });

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: () => api.getUsers() as Promise<TeamUser[]>,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["social-inbox-conversation", conversationId] });
    queryClient.invalidateQueries({ queryKey: ["social-inbox-conversations"] });
    queryClient.invalidateQueries({ queryKey: ["social-inbox-stats"] });
  }

  const updateMutation = useMutation({
    mutationFn: (body: { status?: string; assignedToUserId?: string }) => api.updateSocialInboxConversation(conversationId, body),
    onSuccess: invalidate,
    onError: (err) => setError((err as Error).message),
  });

  const replyMutation = useMutation({
    mutationFn: (text: string) => api.replySocialInboxConversation(conversationId, text),
    onSuccess: () => {
      setReplyText("");
      invalidate();
    },
    onError: (err) => setError((err as Error).message),
  });

  const createNoteMutation = useMutation({
    mutationFn: (note: string) => api.createSocialInboxNote(conversationId, note),
    onSuccess: () => {
      setNoteText("");
      invalidate();
    },
    onError: (err) => setError((err as Error).message),
  });

  const updateNoteMutation = useMutation({
    mutationFn: ({ noteId, note }: { noteId: string; note: string }) => api.updateSocialInboxNote(conversationId, noteId, note),
    onSuccess: () => {
      setEditingNoteId(null);
      invalidate();
    },
    onError: (err) => setError((err as Error).message),
  });

  const deleteNoteMutation = useMutation({
    mutationFn: (noteId: string) => api.deleteSocialInboxNote(conversationId, noteId),
    onSuccess: invalidate,
    onError: (err) => setError((err as Error).message),
  });

  if (detailQuery.isLoading) {
    return (
      <div className="card flex h-full items-center justify-center">
        <LoadingRow label="Loading conversation…" />
      </div>
    );
  }

  const conversation = detailQuery.data;
  if (!conversation) {
    return <div className="card flex h-full items-center justify-center text-sm text-ink/50">Conversation not found.</div>;
  }

  const platformCaps = capabilitiesByPlatform[conversation.socialAccount.platform];
  const canReply = platformCaps?.dms ?? false;

  function submitReply(e: React.FormEvent) {
    e.preventDefault();
    if (!replyText.trim()) return;
    replyMutation.mutate(replyText.trim());
  }

  function submitNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteText.trim()) return;
    createNoteMutation.mutate(noteText.trim());
  }

  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
        <div>
          <div className="text-sm font-semibold">{conversation.contactName || conversation.contactUsername || "Unknown contact"}</div>
          <div className="text-xs text-ink/50">
            {conversation.socialAccount.platform} · @{conversation.socialAccount.username}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={conversation.status}
            onChange={(e) => updateMutation.mutate({ status: e.target.value })}
            disabled={updateMutation.isPending}
            className="rounded border border-[var(--line)] bg-transparent px-2 py-1 text-xs"
          >
            <option value="OPEN">Open</option>
            <option value="PENDING">Pending</option>
            <option value="CLOSED">Closed</option>
          </select>
          <select
            value={conversation.assignedToUserId ?? ""}
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
        {conversation.messages.map((m) => (
          <div key={m.id} className={`flex ${m.fromUs ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                m.fromUs ? "bg-accent text-white" : "border border-[var(--line)]"
              }`}
            >
              <div className="whitespace-pre-wrap">{m.messageText}</div>
              {m.mediaUrl && (
                <a href={m.mediaUrl} target="_blank" rel="noreferrer" className={`mt-1 block text-xs underline ${m.fromUs ? "text-white/80" : "text-accent"}`}>
                  Attachment
                </a>
              )}
              <div className={`mt-1 text-[10px] ${m.fromUs ? "text-white/70" : "text-ink/40"}`}>{timeAgo(m.sentAt)}</div>
            </div>
          </div>
        ))}
        {conversation.messages.length === 0 && <p className="py-8 text-center text-xs text-ink/40">No messages yet.</p>}
      </div>

      {/* Internal notes — visually distinct from the message thread above,
          and never sent to the platform (Part: Internal Notes). */}
      <div className="border-t border-[var(--line)] bg-gold/5 px-4 py-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gold">Internal notes — team only</div>
        <div className="mb-2 space-y-1.5">
          {conversation.notes.map((n) => (
            <div key={n.id} className="rounded border border-gold/30 bg-gold/10 px-2.5 py-1.5 text-xs">
              {editingNoteId === n.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (editingNoteText.trim()) updateNoteMutation.mutate({ noteId: n.id, note: editingNoteText.trim() });
                  }}
                  className="flex gap-1.5"
                >
                  <input
                    autoFocus
                    value={editingNoteText}
                    onChange={(e) => setEditingNoteText(e.target.value)}
                    className="flex-1 rounded border border-[var(--line)] bg-transparent px-2 py-1 text-xs"
                  />
                  <button type="submit" className="text-accent hover:underline">Save</button>
                  <button type="button" onClick={() => setEditingNoteId(null)} className="text-ink/50 hover:underline">Cancel</button>
                </form>
              ) : (
                <>
                  <div className="whitespace-pre-wrap">{n.note}</div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-ink/45">
                    <span>{n.user.name} · {timeAgo(n.createdAt)}</span>
                    <span className="flex gap-2">
                      <button
                        onClick={() => {
                          setEditingNoteId(n.id);
                          setEditingNoteText(n.note);
                        }}
                        className="hover:underline"
                      >
                        Edit
                      </button>
                      <button onClick={() => deleteNoteMutation.mutate(n.id)} className="text-bad hover:underline">
                        Delete
                      </button>
                    </span>
                  </div>
                </>
              )}
            </div>
          ))}
          {conversation.notes.length === 0 && <p className="text-[11px] text-ink/40">No internal notes yet.</p>}
        </div>
        <form onSubmit={submitNote} className="flex gap-1.5">
          <input
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Add an internal note (never sent to the contact)…"
            className="flex-1 rounded border border-gold/30 bg-transparent px-2.5 py-1.5 text-xs"
          />
          <button
            type="submit"
            disabled={createNoteMutation.isPending}
            className="rounded bg-gold px-2.5 py-1.5 text-xs text-white disabled:opacity-50"
          >
            Add
          </button>
        </form>
      </div>

      {/* Reply box — disabled with an explanation when the platform's
          official API doesn't support sending (Part: Reply Interface /
          Platform API Limitations, never a workaround). */}
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
              Send
            </button>
          </form>
        ) : (
          <p className="text-xs text-ink/45">
            Replying isn&apos;t available here: {platformCaps?.notes || `${conversation.socialAccount.platform}'s official API doesn't support sending direct messages.`}
          </p>
        )}
      </div>
    </div>
  );
}
