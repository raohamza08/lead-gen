"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../lib/api-client";
import { useRealtimeRefetch } from "../../../lib/realtime";
import { ConversationDetailPanel } from "../../../components/social-inbox/conversation-detail-panel";
import { LoadingRow, Spinner } from "../../../components/spinner";

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

export default function SocialInboxPage() {
  return (
    <Suspense fallback={<LoadingRow />}>
      <SocialInboxPageContent />
    </Suspense>
  );
}

function SocialInboxPageContent() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const [platformFilter, setPlatformFilter] = useState("");
  const [accountId, setAccountId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams?.get("conversationId") ?? null);

  const accountsQuery = useQuery({
    queryKey: ["social-inbox-accounts"],
    queryFn: () => api.getSocialAccounts() as Promise<SocialAccountItem[]>,
  });
  const capabilitiesQuery = useQuery({
    queryKey: ["social-inbox-capabilities"],
    queryFn: () => api.getSocialCapabilities() as Promise<Record<string, Capabilities>>,
  });
  const statsQuery = useQuery({
    queryKey: ["social-inbox-stats"],
    queryFn: () => api.getSocialInboxStats() as Promise<{ total: number; unread: number; open: number; pending: number; closed: number }>,
  });

  const conversationsQuery = useQuery({
    queryKey: ["social-inbox-conversations", platformFilter, accountId, statusFilter, unreadOnly, search, page],
    queryFn: () => {
      const params: Record<string, string> = { page: String(page), pageSize: String(PAGE_SIZE) };
      if (platformFilter) params.platform = platformFilter;
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
    queryClient.invalidateQueries({ queryKey: ["social-inbox-accounts"] });
  }
  useRealtimeRefetch(["socialInbox.messageReceived", "socialInbox.conversationUpdated"], invalidateAll);

  const accounts = accountsQuery.data ?? [];
  const conversations = conversationsQuery.data?.conversations ?? [];
  const total = conversationsQuery.data?.total ?? 0;
  const platforms = Array.from(new Set(accounts.map((a) => a.platform)));

  function resetPage<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">Social Inbox</h1>
          {conversationsQuery.isFetching && !conversationsQuery.isLoading && <Spinner className="h-3.5 w-3.5" />}
          {statsQuery.data && statsQuery.data.unread > 0 && (
            <span className="rounded-full bg-bad px-2 py-0.5 text-[11px] font-semibold text-white">{statsQuery.data.unread} unread</span>
          )}
        </div>
      </div>
      {statsQuery.data && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink/55">
          <span>{statsQuery.data.total} conversations</span>
          <span>{statsQuery.data.open} open</span>
          <span>{statsQuery.data.pending} pending</span>
          <span>{statsQuery.data.closed} closed</span>
          <span>{accounts.length} accounts</span>
        </div>
      )}
      <div className="flex justify-end">
        <input
          value={search}
          onChange={(e) => resetPage(setSearch)(e.target.value)}
          placeholder="Search contact, message, account…"
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
              {platforms.map((p) => (
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
                .map((a) => (
                  <button
                    key={a.id}
                    onClick={() => resetPage(setAccountId)(a.id)}
                    className={`rounded px-2 py-1 text-left text-xs ${accountId === a.id ? "bg-accent font-medium text-white" : "hover:bg-ink/5"}`}
                  >
                    {a.displayName || a.username}
                  </button>
                ))}
              {accounts.length === 0 && !accountsQuery.isLoading && (
                <span className="text-[11px] text-ink/40">No connected accounts yet.</span>
              )}
            </div>
          </div>
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
              conversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`flex w-full flex-col gap-1 border-b border-[var(--line)] px-3 py-2.5 text-left last:border-0 hover:bg-ink/5 ${
                    selectedId === c.id ? "bg-accent/10" : ""
                  } ${c.unreadCount > 0 ? "font-medium" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm">{c.contactName || c.contactUsername || "Unknown contact"}</span>
                    <span className="shrink-0 text-[10px] font-normal text-ink/40">{timeAgo(c.lastMessageAt)}</span>
                  </div>
                  <div className="line-clamp-1 text-xs font-normal text-ink/55">{c.lastMessage || "—"}</div>
                  <div className="flex items-center justify-between gap-2 text-[10px] font-normal text-ink/45">
                    <span>
                      {c.socialAccount.platform} · @{c.socialAccount.username}
                    </span>
                    <span className="flex items-center gap-1">
                      {c.unreadCount > 0 && (
                        <span className="rounded-full bg-bad px-1.5 py-0 text-white">{c.unreadCount}</span>
                      )}
                      <span className="rounded-full border border-[var(--line)] px-1.5 py-0">{c.status}</span>
                    </span>
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
