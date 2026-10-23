"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api-client";
import { useRealtimeRefetch } from "../../lib/realtime";
import { ConversationDetailPanel } from "./conversation-detail-panel";
import { Avatar } from "../ui/avatar";
import { Tabs } from "../ui/tabs";
import { Modal } from "../ui/modal";
import { LoadingRow, Spinner } from "../spinner";
import { RecordRow } from "../record-list";

interface SocialAccountItem {
  id: string;
  platform: string;
  username: string;
  displayName: string | null;
  status: string;
}

interface ConversationListItem {
  id: string;
  contactName: string | null;
  contactUsername: string | null;
  contactProfileImageUrl?: string | null;
  lastMessage: string | null;
  lastMessageAt: string;
  unreadCount: number;
  status: "OPEN" | "PENDING" | "CLOSED";
  socialAccount: { id: string; platform: string; username: string; displayName: string | null };
  assignedToUser: { id: string; name: string } | null;
}

interface Capabilities {
  dms: boolean;
  notes: string;
}

const PAGE_SIZE = 25;

const CHIPS = [
  { value: "", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "OPEN", label: "Open" },
  { value: "PENDING", label: "Pending" },
  { value: "CLOSED", label: "Closed" },
] as const;

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * A single platform's own DM inbox, styled after WhatsApp Web (Part: Social
 * Inbox removal / per-module messaging follow-up, 2026-10-21, explicit user
 * request — "create the ui exactly like whatsapp web"). One chat list
 * (search + status/unread chips instead of a separate filter sidebar) plus
 * a detail pane, same two-pane shape WhatsApp Web itself uses — this app's
 * CRM-only concepts (status, assignment, internal notes, convert-to-lead)
 * don't exist in real WhatsApp Web, so per explicit user decision they're
 * kept but relocated into ConversationDetailPanel's collapsible contact-info
 * panel rather than cluttering the chat list rows the way the old
 * centralized Social Inbox page showed them inline.
 */
export function PlatformInbox({
  platform,
  initialAccountId,
  initialConversationId,
}: {
  platform: string;
  initialAccountId?: string;
  initialConversationId?: string;
}) {
  const queryClient = useQueryClient();

  const [accountId, setAccountId] = useState(initialAccountId ?? "");
  const [chip, setChip] = useState<(typeof CHIPS)[number]["value"]>("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId ?? null);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newChatAccountId, setNewChatAccountId] = useState("");
  const [newChatTo, setNewChatTo] = useState("");
  const [newChatText, setNewChatText] = useState("");
  const [newChatError, setNewChatError] = useState<string | null>(null);

  const statusFilter = chip === "unread" || chip === "" ? "" : chip;
  const unreadOnly = chip === "unread";

  const accountsQuery = useQuery({
    queryKey: ["social-media-accounts"],
    queryFn: () => api.getSocialAccounts() as Promise<SocialAccountItem[]>,
  });
  const capabilitiesQuery = useQuery({
    queryKey: ["social-media-capabilities"],
    queryFn: () => api.getSocialCapabilities() as Promise<Record<string, Capabilities>>,
  });

  const conversationsQuery = useQuery({
    queryKey: ["social-inbox-conversations", platform, accountId, statusFilter, unreadOnly, search, page],
    queryFn: () => {
      const params: Record<string, string> = { page: String(page), pageSize: String(PAGE_SIZE), platform };
      if (accountId) params.accountId = accountId;
      if (statusFilter) params.status = statusFilter;
      if (unreadOnly) params.unreadOnly = "true";
      if (search.trim()) params.search = search.trim();
      return api.getSocialInboxConversations(params) as Promise<{ conversations: ConversationListItem[]; total: number }>;
    },
  });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["social-inbox-conversations"] });
    queryClient.invalidateQueries({ queryKey: ["social-inbox-stats"] });
    queryClient.invalidateQueries({ queryKey: ["social-media-accounts"] });
  }
  useRealtimeRefetch(["socialInbox.messageReceived", "socialInbox.conversationUpdated"], invalidateAll);

  const accounts = useMemo(() => (accountsQuery.data ?? []).filter((a) => a.platform === platform), [accountsQuery.data, platform]);
  const conversations = conversationsQuery.data?.conversations ?? [];
  const total = conversationsQuery.data?.total ?? 0;

  function resetPage<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

  // Starting a brand-new chat, not replying to an existing one (Part:
  // Social Inbox removal / per-module messaging follow-up, 2026-10-21,
  // explicit user request — "add an option for whatsapp to send a message
  // from here as well") — WhatsApp-only (Facebook/Instagram can't cold-
  // message an arbitrary person, see SocialInboxService.startConversation's
  // own docblock), so the button only renders for platform === "WHATSAPP".
  const newChatMutation = useMutation({
    mutationFn: () => api.startSocialConversation(newChatAccountId, newChatTo, newChatText) as Promise<{ conversationId: string }>,
    onSuccess: (res) => {
      setNewChatOpen(false);
      setNewChatTo("");
      setNewChatText("");
      setNewChatError(null);
      setSelectedId(res.conversationId);
      invalidateAll();
    },
    onError: (err) => setNewChatError((err as Error).message),
  });

  function openNewChat() {
    setNewChatAccountId(accountId || accounts[0]?.id || "");
    setNewChatTo("");
    setNewChatText("");
    setNewChatError(null);
    setNewChatOpen(true);
  }

  function submitNewChat(e: React.FormEvent) {
    e.preventDefault();
    if (!newChatAccountId || !newChatTo.trim() || !newChatText.trim()) return;
    newChatMutation.mutate();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]" style={{ height: "calc(100vh - 220px)", minHeight: 520 }}>
      {/* Chat list — WhatsApp Web's own left pane shape: account switcher (if
          more than one number connected) up top, then search, then filter
          chips in place of a separate sidebar, then the list itself. */}
      <div className="card flex flex-col overflow-hidden">
        <div className="flex flex-col gap-2.5 border-b border-[var(--line)] p-3">
          {accounts.length > 1 && (
            <Tabs
              value={accountId}
              onValueChange={resetPage(setAccountId)}
              tabs={[{ value: "", label: "All accounts" }, ...accounts.map((a) => ({ value: a.id, label: a.displayName || a.username }))]}
            />
          )}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/35" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" strokeLinecap="round" />
              </svg>
              <input
                value={search}
                onChange={(e) => resetPage(setSearch)(e.target.value)}
                placeholder="Search"
                className="w-full rounded-full border-0 bg-ink/[0.04] py-2 pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            {/* New chat (Part: Social Inbox removal / per-module messaging
                follow-up, 2026-10-21) -- WhatsApp-only, same reasoning as
                startConversation's own docblock on the backend. */}
            {platform === "WHATSAPP" && (
              <button
                type="button"
                onClick={openNewChat}
                title="New chat"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink/[0.05] text-ink/60 transition-colors hover:bg-ink/10"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CHIPS.map((c) => (
              <button
                key={c.value}
                onClick={() => resetPage(setChip)(c.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  chip === c.value ? "bg-accent text-white" : "bg-ink/[0.05] text-ink/60 hover:bg-ink/10"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversationsQuery.isLoading ? (
            <LoadingRow label="Loading chats…" />
          ) : conversations.length === 0 ? (
            <p className="px-3 py-10 text-center text-xs text-ink/40">No chats match this filter.</p>
          ) : (
            conversations.map((c) => {
              const contactLabel = c.contactName || c.contactUsername || "Unknown contact";
              const unread = c.unreadCount > 0;
              return (
                <RecordRow
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  selected={selectedId === c.id}
                  unread={unread}
                  avatar={<Avatar name={contactLabel} imageUrl={c.contactProfileImageUrl} size={44} />}
                  primary={contactLabel}
                  timestamp={timeAgo(c.lastMessageAt)}
                  timestampUnread={unread}
                  secondary={c.lastMessage || "—"}
                  secondaryUnread={unread}
                  footer={
                    unread ? (
                      <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
                        {c.unreadCount > 99 ? "99+" : c.unreadCount}
                      </span>
                    ) : undefined
                  }
                />
              );
            })
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
      <div className="min-h-0">
        {selectedId ? (
          <ConversationDetailPanel conversationId={selectedId} capabilitiesByPlatform={capabilitiesQuery.data ?? {}} />
        ) : (
          <div className="card flex h-full min-h-[300px] flex-col items-center justify-center gap-2 text-ink/40">
            <svg viewBox="0 0 24 24" className="h-16 w-16 opacity-20" fill="none" stroke="currentColor" strokeWidth={1.2}>
              <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.3-.67L3 21l1.67-6.2A8.5 8.5 0 1 1 21 11.5z" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            <p className="text-sm">Select a chat to start messaging</p>
          </div>
        )}
      </div>

      <Modal open={newChatOpen} onOpenChange={setNewChatOpen} title="New chat">
        <form onSubmit={submitNewChat} className="flex flex-col gap-3">
          {accounts.length > 1 && (
            <label className="block">
              <span className="mb-1 block text-xs text-ink/60">Send from</span>
              <select
                value={newChatAccountId}
                onChange={(e) => setNewChatAccountId(e.target.value)}
                className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName || a.username}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-xs text-ink/60">Phone number</span>
            <input
              autoFocus
              value={newChatTo}
              onChange={(e) => setNewChatTo(e.target.value)}
              placeholder="+92 300 1234567"
              className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink/60">Message</span>
            <textarea
              value={newChatText}
              onChange={(e) => setNewChatText(e.target.value)}
              rows={3}
              placeholder="Type a message"
              className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
            />
          </label>
          {newChatError && (
            <p className="rounded border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-1.5 text-xs text-bad">
              {newChatError}
            </p>
          )}
          <p className="text-[11px] text-ink/40">
            Only works if this number has messaged you before, or within WhatsApp&apos;s 24-hour window — a brand-new
            contact who has never messaged you needs a pre-approved message template, which isn&apos;t built here yet.
          </p>
          <button
            type="submit"
            disabled={newChatMutation.isPending || !newChatAccountId || !newChatTo.trim() || !newChatText.trim()}
            className="flex items-center justify-center gap-1.5 self-start rounded-full bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {newChatMutation.isPending && <Spinner className="h-3.5 w-3.5" />}
            Send
          </button>
        </form>
      </Modal>
    </div>
  );
}
