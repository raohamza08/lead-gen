"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api-client";
import { useRealtimeRefetch } from "../../lib/realtime";
import { ConversationDetailPanel } from "./conversation-detail-panel";
import { Avatar } from "../ui/avatar";
import { Tabs } from "../ui/tabs";
import { LoadingRow } from "../spinner";

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

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/**
 * A single platform's own DM inbox (Part: Social Inbox removal / per-module
 * messaging, 2026-10-21) — replaces the centralized /social-inbox page,
 * scoped to one platform instead of a platform-selector column, same
 * underlying endpoints (getSocialInboxConversations/Conversation/reply/
 * notes — all already platform/account-filterable, zero backend change).
 * Only rendered by a platform page when capabilities[platform].dms is true.
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
  const [statusFilter, setStatusFilter] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId ?? null);

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

  const accounts = (accountsQuery.data ?? []).filter((a) => a.platform === platform);
  const conversations = conversationsQuery.data?.conversations ?? [];
  const total = conversationsQuery.data?.total ?? 0;

  function resetPage<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

  return (
    <div className="flex flex-col gap-4">
      {accounts.length > 1 && (
        <Tabs
          value={accountId}
          onValueChange={resetPage(setAccountId)}
          tabs={[{ value: "", label: "All accounts" }, ...accounts.map((a) => ({ value: a.id, label: a.displayName || a.username }))]}
        />
      )}
      <div className="flex justify-end">
        <input
          value={search}
          onChange={(e) => resetPage(setSearch)(e.target.value)}
          placeholder="Search contact or message…"
          className="min-w-[260px] rounded-full border border-[var(--line)] bg-transparent px-3.5 py-2 text-sm"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[180px_340px_1fr]">
        {/* Filters */}
        <div className="card flex h-fit flex-col gap-4 p-4 lg:sticky lg:top-4">
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink/50">Status</div>
            <div className="flex flex-col gap-1">
              {["", "OPEN", "PENDING", "CLOSED"].map((s) => (
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
            <input type="checkbox" checked={unreadOnly} onChange={(e) => resetPage(setUnreadOnly)(e.target.checked)} />
            Unread only
          </label>
        </div>

        {/* Conversation list */}
        <div className="card flex h-fit flex-col overflow-hidden lg:max-h-[75vh]">
          <div className="flex-1 overflow-y-auto">
            {conversationsQuery.isLoading ? (
              <LoadingRow label="Loading conversations…" />
            ) : conversations.length === 0 ? (
              <p className="px-3 py-10 text-center text-xs text-ink/40">No conversations match these filters.</p>
            ) : (
              conversations.map((c) => {
                const contactLabel = c.contactName || c.contactUsername || "Unknown contact";
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`flex w-full items-center gap-2.5 border-b border-[var(--line)] px-3 py-2.5 text-left last:border-0 hover:bg-ink/5 ${
                      selectedId === c.id ? "bg-accent/10" : ""
                    }`}
                  >
                    <Avatar name={contactLabel} imageUrl={c.contactProfileImageUrl} size={40} />
                    <div className={`min-w-0 flex-1 ${c.unreadCount > 0 ? "font-medium" : ""}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm">{contactLabel}</span>
                        <span className="shrink-0 text-[10px] font-normal text-ink/40">{timeAgo(c.lastMessageAt)}</span>
                      </div>
                      <div className="line-clamp-1 text-xs font-normal text-ink/55">{c.lastMessage || "—"}</div>
                      <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] font-normal text-ink/45">
                        <span>@{c.socialAccount.username}</span>
                        <span className="flex items-center gap-1">
                          {c.unreadCount > 0 && <span className="rounded-full bg-bad px-1.5 py-0 text-white">{c.unreadCount}</span>}
                          <span className="rounded-full border border-[var(--line)] px-1.5 py-0">{c.status}</span>
                        </span>
                      </div>
                      {c.assignedToUser && <div className="mt-0.5 text-[10px] font-normal text-ink/40">Assigned: {c.assignedToUser.name}</div>}
                    </div>
                  </button>
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
        <div className="lg:max-h-[75vh]">
          {selectedId ? (
            <ConversationDetailPanel conversationId={selectedId} capabilitiesByPlatform={capabilitiesQuery.data ?? {}} />
          ) : (
            <div className="card flex h-full min-h-[300px] items-center justify-center text-sm text-ink/40">
              Select a conversation to view it.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
