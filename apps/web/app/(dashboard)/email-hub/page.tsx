"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../lib/api-client";
import { useRealtimeRefetch } from "../../../lib/realtime";
import { ComposeModal } from "../../../components/email-hub/compose-modal";
import { MessageDetailPanel } from "../../../components/email-hub/message-detail-panel";
import { LoadingRow, Spinner } from "../../../components/spinner";
import { Button } from "../../../components/ui/button";
import { StatusBadge } from "../../../components/ui/status-badge";
import { Tabs } from "../../../components/ui/tabs";
import { Table, TableHead, TableHeadRow, Th, TableBody, Tr, Td, TableEmptyRow } from "../../../components/ui/table";

interface Account {
  id: string;
  address: string;
  mailboxLabel: string | null;
  unreadCount: number;
}

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface Stats {
  connectedAccounts: number;
  unread: number;
  important: number;
  receivedToday: number;
  receivedThisWeek: number;
  leadsFromEmail: number;
  ignored: number;
  possibleLeads: number;
}

interface TrackedEmail {
  id: string;
  toAddress: string;
  subject: string;
  sentAt: string;
  openedAt: string | null;
  verifiedOpenedAt: string | null;
  rawOpenCount: number;
}

interface SentStatus {
  sentAt: string;
  viewedAt: string | null;
  verifiedViewedAt: string | null;
  repliedAt: string | null;
}

interface Message {
  id: string;
  threadId: string;
  accountId: string;
  fromName: string | null;
  fromEmail: string;
  toEmails: string[];
  folder: string;
  subject: string;
  bodyText: string;
  receivedAt: string;
  isRead: boolean;
  isImportant: boolean;
  isIgnored: boolean;
  hasAttachments: boolean;
  suggestedCategory: string | null;
  aiSuggestedAction: string | null;
  account: { id: string; address: string; mailboxLabel: string | null };
  thread: { id: string; leadId: string | null };
  tags: { tag: Tag }[];
  sentStatus: SentStatus | null;
}

/** Maps the sidebar's `?view=` sub-items onto the API's status filter — the
 *  "Leads"/"Follow-ups" views aren't first-class message states in the
 *  schema, so they're expressed here as a status + (for Leads) a
 *  client-side filter on thread.leadId. "Sent" *is* first-class (folder:
 *  "SENT" on the row, synced from the mailbox's real Sent folder — see
 *  ImapReaderProvider.findSentMailbox), so it maps directly. */
function statusForView(view: string | null): "UNREAD" | "IMPORTANT" | "IGNORED" | "ALL" | "LEADS" | "SENT" {
  if (view === "important") return "IMPORTANT";
  if (view === "ignored") return "IGNORED";
  if (view === "leads") return "LEADS";
  if (view === "sent") return "SENT";
  return "ALL";
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Exact, not relative — down to the minute, since "1h ago" goes stale the
 *  moment you glance away and the whole point of this timeline is knowing
 *  precisely when each stage happened. */
function exactTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Compact single-badge summary of a sent message's furthest-reached stage
 *  (Part: Email Hub sent-status timeline, 2026-09-02) — the full Sent/
 *  Viewed/Replied breakdown lives in the thread detail view
 *  (message-detail-panel.tsx's SentStatusRow); a list row only has room for
 *  the headline. */
function SentStatusChip({ status }: { status: SentStatus }) {
  if (status.repliedAt) return <StatusBadge tone="accent" label={`Replied · ${exactTime(status.repliedAt)}`} />;
  if (status.verifiedViewedAt) return <StatusBadge tone="success" label={`Viewed · ${exactTime(status.verifiedViewedAt)}`} />;
  if (status.viewedAt) {
    return (
      <span title="Pixel fired too soon after sending to rule out prefetching (common for Gmail) — likely not a confirmed view">
        <StatusBadge tone="warning" label={`Possibly viewed · ${exactTime(status.viewedAt)}`} />
      </span>
    );
  }
  return <StatusBadge tone="neutral" label={`Sent · ${exactTime(status.sentAt)}`} />;
}

export default function EmailHubPage() {
  return (
    <Suspense fallback={<LoadingRow />}>
      <EmailHubPageContent />
    </Suspense>
  );
}

function EmailHubPageContent() {
  const searchParams = useSearchParams();
  const view = searchParams?.get("view") ?? null;
  const queryClient = useQueryClient();

  const [accountId, setAccountId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string>("");
  // Which muted-sender sub-tab is selected under the Ignored view — "" means
  // every ignored message, unfiltered (Part: Ignore/Noise Management,
  // per-sender grouping).
  const [senderFilter, setSenderFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingLeadId, setConfirmingLeadId] = useState<string | null>(null);

  const status = statusForView(view);
  // "Tracked" isn't a message-list status at all (it's HubEmailOpenTracking
  // rows, a different shape entirely) — handled as its own early-return
  // branch below rather than folded into the message-status union.
  const isTrackedView = view === "tracked";
  const trackedQuery = useQuery({
    queryKey: ["tracked-emails"],
    queryFn: () => api.getTrackedEmails() as Promise<TrackedEmail[]>,
    enabled: isTrackedView,
  });

  // The sidebar's view links are plain navigation (query-string change, no
  // state setter), so this is the one filter change resetPage can't cover.
  // senderFilter only makes sense within the Ignored view it belongs to —
  // leaving it set while switching to another view would silently narrow
  // that view's results with no visible control to explain why.
  useEffect(() => {
    setPage(1);
    setSenderFilter("");
  }, [view]);

  // Cached: switching tabs and coming back shows this instantly from cache
  // (staleTime in query-provider.tsx) while quietly refetching in the
  // background — isFetching (not isLoading) reflects that background pass.
  const messagesQuery = useQuery({
    queryKey: ["email-messages", status, accountId, search, tagFilter, senderFilter, page, pageSize],
    queryFn: () => {
      const params: Record<string, string> = { status, page: String(page), pageSize: String(pageSize) };
      if (accountId) params.accountId = accountId;
      if (search.trim()) params.search = search.trim();
      if (tagFilter) params.tagIds = tagFilter;
      if (senderFilter) params.sender = senderFilter;
      return api.getEmailMessages(params) as Promise<{ messages: Message[]; total: number }>;
    },
  });
  const accountsQuery = useQuery({
    queryKey: ["email-accounts"],
    queryFn: () => api.getEmailHubAccounts() as Promise<Account[]>,
  });
  const tagsQuery = useQuery({
    queryKey: ["email-tags"],
    queryFn: () => api.getEmailTags() as Promise<Tag[]>,
  });
  // Only meaningful (and only fetched) within the Ignored view.
  const ignoredSendersQuery = useQuery({
    queryKey: ["ignored-senders"],
    queryFn: () => api.getIgnoredSenders(),
    enabled: status === "IGNORED",
  });
  const statsQuery = useQuery({
    queryKey: ["email-stats"],
    queryFn: () => api.getEmailHubStats() as Promise<Stats>,
  });

  // Any filter change invalidates the current page — staying on page 4 of a
  // now-different result set would either show a stale slice or run past the
  // end silently.
  function resetPage<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

  const accounts = accountsQuery.data ?? [];
  const tags = tagsQuery.data ?? [];
  const ignoredSenders = ignoredSendersQuery.data ?? [];
  const total = messagesQuery.data?.total ?? 0;
  const messages = messagesQuery.data?.messages ?? [];

  function invalidateMessages() {
    queryClient.invalidateQueries({ queryKey: ["email-messages"] });
  }
  function invalidateAccounts() {
    queryClient.invalidateQueries({ queryKey: ["email-accounts"] });
  }
  function invalidateStats() {
    queryClient.invalidateQueries({ queryKey: ["email-stats"] });
  }
  function invalidateIgnoredSenders() {
    queryClient.invalidateQueries({ queryKey: ["ignored-senders"] });
  }

  useRealtimeRefetch(["emailHub.messageReceived", "emailHub.messagesUpdated"], () => {
    invalidateMessages();
    invalidateAccounts();
    invalidateStats();
    invalidateIgnoredSenders();
  });

  const allSelected = messages.length > 0 && selected.size === messages.length;
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(messages.map((m) => m.id)));
  }
  function toggleOne(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const bulkActionMutation = useMutation({
    mutationFn: (input: { action: string; tagId?: string; ignoreScope?: "SENDER" | "DOMAIN" }) =>
      api.bulkEmailAction({ messageIds: [...selected], action: input.action, tagId: input.tagId, ignoreScope: input.ignoreScope }),
    onSuccess: () => {
      setSelected(new Set());
      invalidateMessages();
      invalidateAccounts();
      invalidateStats();
      invalidateIgnoredSenders();
    },
    onError: (err) => setActionError((err as Error).message),
  });
  function bulkAction(action: string, tagId?: string, ignoreScope?: "SENDER" | "DOMAIN") {
    if (selected.size === 0) return;
    bulkActionMutation.mutate({ action, tagId, ignoreScope });
  }

  const unignoreRuleMutation = useMutation({
    mutationFn: (ruleId: string) => api.unignoreRule(ruleId),
    onSuccess: () => {
      invalidateMessages();
      invalidateStats();
      invalidateIgnoredSenders();
    },
    onError: (err) => setActionError((err as Error).message),
  });

  const confirmLeadMutation = useMutation({
    mutationFn: (threadId: string) => api.addEmailThreadToLead(threadId),
    onMutate: (threadId) => setConfirmingLeadId(threadId),
    onSuccess: () => {
      invalidateMessages();
      invalidateStats();
    },
    onError: (err) => setActionError((err as Error).message),
    onSettled: () => setConfirmingLeadId(null),
  });
  function confirmPossibleLead(threadId: string, e: React.MouseEvent) {
    e.stopPropagation();
    confirmLeadMutation.mutate(threadId);
  }

  const markReadMutation = useMutation({
    mutationFn: (messageId: string) => api.bulkEmailAction({ messageIds: [messageId], action: "READ" }),
    onSuccess: () => {
      invalidateMessages();
      invalidateStats();
    },
  });
  function openMessage(m: Message) {
    setOpenThreadId(m.threadId);
    if (!m.isRead) markReadMutation.mutate(m.id);
  }

  const createTagMutation = useMutation({
    mutationFn: (name: string) => api.createEmailTag({ name }),
    onSuccess: () => {
      setNewTagName("");
      queryClient.invalidateQueries({ queryKey: ["email-tags"] });
    },
    onError: (err) => setActionError((err as Error).message),
  });
  function createTag(e: React.FormEvent) {
    e.preventDefault();
    if (!newTagName.trim()) return;
    createTagMutation.mutate(newTagName.trim());
  }

  const deleteTagMutation = useMutation({
    mutationFn: (tagId: string) => api.deleteEmailTag(tagId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["email-tags"] }),
  });

  const viewTitle = useMemo(() => {
    if (view === "important") return "Important";
    if (view === "ignored") return "Ignored";
    if (view === "leads") return "Leads";
    if (view === "followups") return "Follow-ups";
    if (view === "sent") return "Sent";
    if (view === "tracked") return "Tracked";
    return "Unified Inbox";
  }, [view]);

  const error = actionError ?? (messagesQuery.error as Error | null)?.message ?? null;

  if (isTrackedView) return <TrackedEmailsView query={trackedQuery} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">{viewTitle}</h1>
          {/* Background refetch indicator — only shows once real data is
              already on screen, so a cached revisit never feels like a
              fresh load even though it's quietly re-verifying. */}
          {messagesQuery.isFetching && !messagesQuery.isLoading && <Spinner className="h-3.5 w-3.5" />}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setShowTagManager((v) => !v)}>
            Manage tags
          </Button>
          <Button size="sm" onClick={() => setShowCompose(true)}>
            New email
          </Button>
        </div>
      </div>

      {statsQuery.data && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink/55">
          <span>{total} in this view</span>
          <span>{statsQuery.data.unread} unread</span>
          <span>{statsQuery.data.leadsFromEmail} leads</span>
          <span>{statsQuery.data.possibleLeads} possible leads</span>
          <span>{statsQuery.data.connectedAccounts} accounts</span>
        </div>
      )}

      {status === "IGNORED" && ignoredSenders.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-[var(--line)] pb-3">
          <button
            onClick={() => setSenderFilter("")}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              senderFilter === "" ? "bg-accent text-white" : "bg-ink/8 text-ink/60 hover:bg-ink/12"
            }`}
          >
            All ignored
          </button>
          {ignoredSenders.map((s) => {
            const label = s.ruleType === "DOMAIN" ? `@${s.senderDomain}` : (s.fromEmail ?? "");
            const filterValue = s.ruleType === "DOMAIN" ? (s.senderDomain ?? "") : (s.fromEmail ?? "");
            const detail = [
              s.ruleType === "DOMAIN" ? "Entire domain" : "Sender",
              `Ignored ${new Date(s.createdAt).toLocaleDateString()}`,
              s.createdByName ? `Added by ${s.createdByName}` : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <span
                key={s.id}
                title={detail}
                className={`flex max-w-[280px] items-center gap-1 rounded-full py-1 pl-3 pr-1 text-xs font-medium transition-colors ${
                  senderFilter === filterValue ? "bg-accent text-white" : "bg-ink/8 text-ink/60 hover:bg-ink/12"
                }`}
              >
                <button onClick={() => setSenderFilter(filterValue)} className="max-w-[190px] truncate">
                  {label} ({s.count})
                </button>
                <button
                  onClick={() => unignoreRuleMutation.mutate(s.id)}
                  disabled={unignoreRuleMutation.isPending}
                  title="Unignore"
                  className={`shrink-0 rounded-full px-1.5 leading-none ${
                    senderFilter === filterValue ? "hover:bg-white/20" : "hover:bg-ink/15"
                  }`}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
          {error}
        </div>
      )}

      {showTagManager && (
        <div className="card p-4">
          <form onSubmit={createTag} className="mb-3 flex gap-2">
            <input
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              placeholder="New tag name"
              className="rounded border border-[var(--line)] bg-transparent px-3 py-1.5 text-sm"
            />
            <Button type="submit" size="sm">
              Add tag
            </Button>
          </form>
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <span key={t.id} className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-white" style={{ backgroundColor: t.color }}>
                {t.name}
                <button
                  onClick={() => deleteTagMutation.mutate(t.id)}
                  className="text-white/80 hover:text-white"
                  aria-label={`Delete tag ${t.name}`}
                >
                  ✕
                </button>
              </span>
            ))}
            {tags.length === 0 && <span className="text-xs text-ink/50">No tags yet.</span>}
          </div>
        </div>
      )}

      {/* Account switcher — All accounts + one tab per connected mailbox
          (Part: Individual Account View / Unified Inbox toggle). */}
      {accounts.length === 0 && !accountsQuery.isLoading ? (
        <span className="text-xs text-ink/50">
          No inbox-connected accounts yet — add one in Settings &gt; Email Hub &gt; Accounts.
        </span>
      ) : (
        <Tabs
          value={accountId}
          onValueChange={(v) => resetPage(setAccountId)(v)}
          tabs={[
            { value: "", label: "All accounts" },
            ...accounts.map((a) => ({ value: a.id, label: a.mailboxLabel || a.address, count: a.unreadCount })),
          ]}
        />
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => resetPage(setSearch)(e.target.value)}
          placeholder="Search sender, subject, body…"
          className="min-w-[240px] flex-1 rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
        />
        <select
          value={tagFilter}
          onChange={(e) => resetPage(setTagFilter)(e.target.value)}
          className="rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
        >
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {/* Bulk action toolbar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-ink/5 px-3 py-2 text-xs">
          <span className="font-medium">{selected.size} selected</span>
          <Button variant="secondary" size="sm" disabled={bulkActionMutation.isPending} onClick={() => bulkAction("READ")}>Mark read</Button>
          <Button variant="secondary" size="sm" disabled={bulkActionMutation.isPending} onClick={() => bulkAction("UNREAD")}>Mark unread</Button>
          <Button variant="secondary" size="sm" disabled={bulkActionMutation.isPending} onClick={() => bulkAction("IMPORTANT")}>Mark important</Button>
          <Button variant="secondary" size="sm" disabled={bulkActionMutation.isPending} onClick={() => bulkAction("IGNORE", undefined, "SENDER")}>Ignore sender</Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={bulkActionMutation.isPending}
            onClick={() => bulkAction("IGNORE", undefined, "DOMAIN")}
            title="Mutes every sender at the selected messages' domain(s), not just these exact addresses"
          >
            Ignore domain
          </Button>
          <Button variant="secondary" size="sm" disabled={bulkActionMutation.isPending} onClick={() => bulkAction("UNIGNORE")}>Unignore</Button>
          {tags.length > 0 && (
            <select
              disabled={bulkActionMutation.isPending}
              onChange={(e) => e.target.value && bulkAction("ADD_TAG", e.target.value)}
              defaultValue=""
              className="rounded border border-[var(--line)] bg-transparent px-2 py-1"
            >
              <option value="" disabled>
                Add tag…
              </option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <Button
            variant="danger"
            size="sm"
            disabled={bulkActionMutation.isPending}
            onClick={() => window.confirm(`Delete ${selected.size} message(s)? This removes them from the Email Hub, not the real mailbox.`) && bulkAction("DELETE")}
          >
            Delete
          </Button>
        </div>
      )}

      {/* Message list */}
      {messagesQuery.isLoading ? (
        <div className="card">
          <LoadingRow label="Loading messages…" />
        </div>
      ) : (
        <Table>
          <TableHead>
            <TableHeadRow>
              <Th className="w-8">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              </Th>
              <Th>{status === "SENT" ? "To" : "Sender"}</Th>
              <Th>Subject</Th>
              <Th>Account</Th>
              <Th>Tags</Th>
              <Th className="text-right">Received</Th>
            </TableHeadRow>
          </TableHead>
          <TableBody>
            {messages.map((m) => (
              <Tr key={m.id} onClick={() => openMessage(m)} className={m.isRead ? "" : "font-medium"}>
                <Td>
                  <span onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggleOne(m.id)} />
                  </span>
                </Td>
                <Td>
                  {m.folder === "SENT" ? (
                    <div>{m.toEmails.join(", ") || "(no recipient)"}</div>
                  ) : (
                    <>
                      <div>{m.fromName || m.fromEmail}</div>
                      <div className="text-xs font-normal text-ink/50">{m.fromEmail}</div>
                    </>
                  )}
                </Td>
                <Td>
                  <div className="flex items-center gap-1.5">
                    {m.isImportant && <span className="text-warning">★</span>}
                    {m.hasAttachments && <span title="Has attachments">📎</span>}
                    <span className="line-clamp-1">{m.subject}</span>
                  </div>
                  <div className="line-clamp-1 text-xs font-normal text-ink/50">{m.bodyText.slice(0, 120)}</div>
                </Td>
                <Td className="text-xs font-normal text-ink/60">
                  {m.account.mailboxLabel || m.account.address}
                </Td>
                <Td>
                  <div className="flex flex-wrap items-center gap-1">
                    {m.sentStatus && <SentStatusChip status={m.sentStatus} />}
                    {m.thread.leadId && <StatusBadge tone="accent" label="Lead" />}
                    {!m.thread.leadId && m.suggestedCategory === "POSSIBLE_LEAD" && (
                      <span
                        className="flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] text-warning"
                        title={m.aiSuggestedAction ?? undefined}
                      >
                        Possible lead
                        <button
                          onClick={(e) => confirmPossibleLead(m.thread.id, e)}
                          disabled={confirmingLeadId === m.thread.id}
                          className="rounded-full border border-warning/40 px-1.5 py-0 text-[10px] font-medium transition-colors duration-fast hover:bg-warning/10 disabled:opacity-50"
                        >
                          {confirmingLeadId === m.thread.id ? "Adding…" : "Add to Lead"}
                        </button>
                      </span>
                    )}
                    {m.tags.map(({ tag }) => (
                      <span
                        key={tag.id}
                        className="rounded-full px-2 py-0.5 text-[11px] text-white"
                        style={{ backgroundColor: tag.color }}
                      >
                        {tag.name}
                      </span>
                    ))}
                  </div>
                </Td>
                <Td className="text-right text-xs font-normal text-ink/50">{timeAgo(m.receivedAt)}</Td>
              </Tr>
            ))}
            {messages.length === 0 && (
              <TableEmptyRow colSpan={6}>
                {view === "leads" ? "No leads yet — confirmed or AI-suggested ones show up here." : "Nothing here."}
              </TableEmptyRow>
            )}
          </TableBody>
        </Table>
      )}

      {/* Pagination — the API caps every response to one page even when a
          filter matches thousands of emails, so this is required to ever see
          past the first pageSize rows, not just a UX nicety. */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink/50">
        <span>
          {total === 0 ? "0 of 0" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
        </span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5">
            Rows per page
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="rounded border border-[var(--line)] bg-transparent px-1.5 py-1 text-xs"
            >
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <Button variant="ghost" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            ← Prev
          </Button>
          <span>
            Page {page} of {Math.max(1, Math.ceil(total / pageSize))}
          </span>
          <Button variant="ghost" size="sm" disabled={page * pageSize >= total} onClick={() => setPage((p) => p + 1)}>
            Next →
          </Button>
        </div>
      </div>

      {openThreadId && (
        <MessageDetailPanel
          threadId={openThreadId}
          accounts={accounts}
          onClose={() => setOpenThreadId(null)}
          onChanged={() => {
            invalidateMessages();
            invalidateAccounts();
            invalidateStats();
          }}
        />
      )}
      {showCompose && (
        <ComposeModal
          accounts={accounts}
          defaultAccountId={accountId || undefined}
          onClose={() => setShowCompose(false)}
          onSent={invalidateMessages}
        />
      )}
    </div>
  );
}

/**
 * "Track email" results (Part: Email Hub open-tracking visibility,
 * 2026-09-02) — every HubEmailOpenTracking row for the org. Distinguishes
 * three real states rather than a single "opened" boolean: a *verified*
 * open (past the 3-minute anti-prefetch window — the same signal that
 * fires the real-time "Email Opened" notification), a *raw* open (the
 * pixel fired, but too soon to rule out prefetching — for a Gmail
 * recipient this is often the only signal that will ever exist at all,
 * since Gmail proxies/caches images and typically won't fetch the pixel a
 * second time for a genuine later human open), and not opened yet.
 */
function TrackedEmailsView({ query }: { query: { data?: TrackedEmail[]; isLoading: boolean; error: unknown } }) {
  const rows = query.data ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Tracked</h1>
        <p className="mt-0.5 text-xs text-ink/55">
          Every email sent with &quot;Track email&quot; checked. A verified open also sends you a real-time
          notification; a raw-only open (common for Gmail recipients — see below) does not.
        </p>
      </div>
      {query.isLoading ? (
        <div className="card">
          <LoadingRow label="Loading tracked emails…" />
        </div>
      ) : query.error ? (
        <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-error">
          {(query.error as Error).message}
        </div>
      ) : (
        <Table>
          <TableHead>
            <TableHeadRow>
              <Th>To</Th>
              <Th>Subject</Th>
              <Th>Sent</Th>
              <Th>Status</Th>
            </TableHeadRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td className="text-ink/70">{r.toAddress}</Td>
                <Td className="font-medium">{r.subject}</Td>
                <Td className="text-xs text-ink/50">{exactTime(r.sentAt)}</Td>
                <Td>
                  {r.verifiedOpenedAt ? (
                    <StatusBadge tone="success" label={`Opened · ${exactTime(r.verifiedOpenedAt)}`} />
                  ) : r.openedAt ? (
                    <span title="Pixel fired too soon after sending to rule out prefetching (common for Gmail, which proxies images server-side) — likely not a confirmed human open">
                      <StatusBadge tone="warning" label={`Possibly opened · ${exactTime(r.openedAt)}`} />
                    </span>
                  ) : (
                    <StatusBadge tone="neutral" label="Not opened yet" />
                  )}
                </Td>
              </Tr>
            ))}
            {rows.length === 0 && (
              <TableEmptyRow colSpan={4}>
                No tracked emails yet — check &quot;Track email&quot; when composing or replying to start tracking one.
              </TableEmptyRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
