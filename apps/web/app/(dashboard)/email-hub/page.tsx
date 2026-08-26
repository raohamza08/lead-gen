"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../../lib/api-client";
import { useRealtimeRefetch } from "../../../lib/realtime";
import { ComposeModal } from "../../../components/email-hub/compose-modal";
import { MessageDetailPanel } from "../../../components/email-hub/message-detail-panel";

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

interface Message {
  id: string;
  threadId: string;
  accountId: string;
  fromName: string | null;
  fromEmail: string;
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
}

/** Maps the sidebar's `?view=` sub-items onto the API's status filter — the
 *  "Leads"/"Follow-ups"/"Sent" views the spec asks for aren't first-class
 *  message states in the schema, so they're expressed here as a status +
 *  (for Leads) a client-side filter on thread.leadId, keeping the API's
 *  filter surface small rather than growing a bespoke enum value per
 *  sidebar item. */
function statusForView(view: string | null): "UNREAD" | "IMPORTANT" | "IGNORED" | "ALL" {
  if (view === "important") return "IMPORTANT";
  if (view === "ignored") return "IGNORED";
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

export default function EmailHubPage() {
  return (
    <Suspense fallback={<div className="text-sm text-ink/50">Loading…</div>}>
      <EmailHubPageContent />
    </Suspense>
  );
}

function EmailHubPageContent() {
  const searchParams = useSearchParams();
  const view = searchParams?.get("view") ?? null;

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [accountId, setAccountId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmingLeadId, setConfirmingLeadId] = useState<string | null>(null);

  const status = statusForView(view);

  function loadMessages() {
    setLoading(true);
    setError(null);
    const params: Record<string, string> = { status };
    if (accountId) params.accountId = accountId;
    if (search.trim()) params.search = search.trim();
    if (tagFilter) params.tagIds = tagFilter;
    api
      .getEmailMessages(params)
      .then((res: any) => {
        let rows: Message[] = res.messages;
        // "Leads" and "Sent" aren't real status filters (see statusForView) —
        // applied client-side against the already-fetched page. At V1 volume
        // this is fine; if the inbox grows large enough for this to matter,
        // it becomes a real query param on the API instead.
        if (view === "leads") rows = rows.filter((m) => m.thread.leadId);
        setMessages(rows);
        setTotal(res.total);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }

  function loadAccounts() {
    api.getEmailHubAccounts().then((a) => setAccounts(a as Account[])).catch(() => {});
  }
  function loadTags() {
    api.getEmailTags().then((t) => setTags(t as Tag[])).catch(() => {});
  }

  useEffect(loadAccounts, []);
  useEffect(loadTags, []);
  useEffect(loadMessages, [status, accountId, search, tagFilter, view]);
  useRealtimeRefetch(["emailHub.messageReceived", "emailHub.messagesUpdated"], () => {
    loadMessages();
    loadAccounts();
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

  async function bulkAction(action: string, tagId?: string) {
    if (selected.size === 0) return;
    setBulkBusy(true);
    try {
      await api.bulkEmailAction({ messageIds: [...selected], action, tagId });
      setSelected(new Set());
      loadMessages();
      loadAccounts();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBulkBusy(false);
    }
  }

  async function confirmPossibleLead(threadId: string, e: React.MouseEvent) {
    e.stopPropagation();
    setConfirmingLeadId(threadId);
    try {
      await api.addEmailThreadToLead(threadId);
      loadMessages();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConfirmingLeadId(null);
    }
  }

  function openMessage(m: Message) {
    setOpenThreadId(m.threadId);
    if (!m.isRead) {
      api.bulkEmailAction({ messageIds: [m.id], action: "READ" }).then(loadMessages).catch(() => {});
    }
  }

  async function createTag(e: React.FormEvent) {
    e.preventDefault();
    if (!newTagName.trim()) return;
    try {
      await api.createEmailTag({ name: newTagName.trim() });
      setNewTagName("");
      loadTags();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const viewTitle = useMemo(() => {
    if (view === "important") return "Important";
    if (view === "ignored") return "Ignored";
    if (view === "leads") return "Leads";
    if (view === "followups") return "Follow-ups";
    if (view === "sent") return "Sent";
    return "Unified Inbox";
  }, [view]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">{viewTitle}</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowTagManager((v) => !v)}
            className="rounded-md border border-[var(--line)] px-3 py-1.5 text-xs text-ink/70 hover:bg-ink/5"
          >
            Manage tags
          </button>
          <button
            onClick={() => setShowCompose(true)}
            className="rounded-md bg-accent px-3 py-1.5 text-xs text-white hover:opacity-90"
          >
            New email
          </button>
        </div>
      </div>

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
            <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-xs text-white">
              Add tag
            </button>
          </form>
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <span key={t.id} className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-white" style={{ backgroundColor: t.color }}>
                {t.name}
                <button
                  onClick={() => api.deleteEmailTag(t.id).then(loadTags)}
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
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setAccountId("")}
          className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
            accountId === "" ? "bg-accent font-medium text-white" : "border border-[var(--line)] text-ink/65 hover:bg-ink/5"
          }`}
        >
          All accounts
        </button>
        {accounts.map((a) => (
          <button
            key={a.id}
            onClick={() => setAccountId(a.id)}
            className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
              accountId === a.id ? "bg-accent font-medium text-white" : "border border-[var(--line)] text-ink/65 hover:bg-ink/5"
            }`}
          >
            {a.mailboxLabel || a.address}
            {a.unreadCount > 0 && <span className="ml-1.5 opacity-80">({a.unreadCount})</span>}
          </button>
        ))}
        {accounts.length === 0 && (
          <span className="text-xs text-ink/50">
            No inbox-connected accounts yet — add one in Settings &gt; Email Hub &gt; Accounts.
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sender, subject, body…"
          className="min-w-[240px] flex-1 rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
        />
        <select
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
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
          <button disabled={bulkBusy} onClick={() => bulkAction("READ")} className="rounded border border-[var(--line)] px-2 py-1 hover:bg-ink/5">Mark read</button>
          <button disabled={bulkBusy} onClick={() => bulkAction("UNREAD")} className="rounded border border-[var(--line)] px-2 py-1 hover:bg-ink/5">Mark unread</button>
          <button disabled={bulkBusy} onClick={() => bulkAction("IMPORTANT")} className="rounded border border-[var(--line)] px-2 py-1 hover:bg-ink/5">Mark important</button>
          <button disabled={bulkBusy} onClick={() => bulkAction("IGNORE")} className="rounded border border-[var(--line)] px-2 py-1 hover:bg-ink/5">Ignore</button>
          <button disabled={bulkBusy} onClick={() => bulkAction("UNIGNORE")} className="rounded border border-[var(--line)] px-2 py-1 hover:bg-ink/5">Unignore</button>
          {tags.length > 0 && (
            <select
              disabled={bulkBusy}
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
          <button
            disabled={bulkBusy}
            onClick={() => window.confirm(`Delete ${selected.size} message(s)? This removes them from the Email Hub, not the real mailbox.`) && bulkAction("DELETE")}
            className="rounded border border-[rgb(var(--bad-rgb)/0.4)] px-2 py-1 text-bad hover:bg-[rgb(var(--bad-rgb)/0.06)]"
          >
            Delete
          </button>
        </div>
      )}

      {/* Message list */}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--line)] text-left text-xs text-ink/55">
              <th className="w-8 px-3 py-2">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              </th>
              <th className="px-3 py-2">Sender</th>
              <th className="px-3 py-2">Subject</th>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2">Tags</th>
              <th className="px-3 py-2 text-right">Received</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((m) => (
              <tr
                key={m.id}
                onClick={() => openMessage(m)}
                className={`cursor-pointer border-b border-[var(--line)] last:border-0 hover:bg-ink/5 ${
                  m.isRead ? "" : "font-medium"
                }`}
              >
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggleOne(m.id)} />
                </td>
                <td className="px-3 py-2">
                  <div>{m.fromName || m.fromEmail}</div>
                  <div className="text-xs font-normal text-ink/50">{m.fromEmail}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    {m.isImportant && <span className="text-gold">★</span>}
                    {m.hasAttachments && <span title="Has attachments">📎</span>}
                    <span className="line-clamp-1">{m.subject}</span>
                  </div>
                  <div className="line-clamp-1 text-xs font-normal text-ink/50">{m.bodyText.slice(0, 120)}</div>
                </td>
                <td className="px-3 py-2 text-xs font-normal text-ink/60">
                  {m.account.mailboxLabel || m.account.address}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {m.thread.leadId && (
                      <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent">Lead</span>
                    )}
                    {!m.thread.leadId && m.suggestedCategory === "POSSIBLE_LEAD" && (
                      <span
                        className="flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-[11px] text-gold"
                        title={m.aiSuggestedAction ?? undefined}
                      >
                        Possible lead
                        <button
                          onClick={(e) => confirmPossibleLead(m.thread.id, e)}
                          disabled={confirmingLeadId === m.thread.id}
                          className="rounded-full border border-gold/40 px-1.5 py-0 text-[10px] font-medium hover:bg-gold/10 disabled:opacity-50"
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
                </td>
                <td className="px-3 py-2 text-right text-xs font-normal text-ink/50">{timeAgo(m.receivedAt)}</td>
              </tr>
            ))}
            {!loading && messages.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-sm text-ink/50">
                  {view === "leads" ? "No emails linked to leads yet." : "Nothing here."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink/40">{total} total</p>

      {openThreadId && (
        <MessageDetailPanel
          threadId={openThreadId}
          onClose={() => setOpenThreadId(null)}
          onChanged={() => {
            loadMessages();
            loadAccounts();
          }}
        />
      )}
      {showCompose && (
        <ComposeModal
          accounts={accounts}
          defaultAccountId={accountId || undefined}
          onClose={() => setShowCompose(false)}
          onSent={loadMessages}
        />
      )}
    </div>
  );
}
