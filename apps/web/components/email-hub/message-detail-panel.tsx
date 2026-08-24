"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api-client";

interface ThreadMessage {
  id: string;
  fromName: string | null;
  fromEmail: string;
  toEmails: string[];
  ccEmails: string[];
  subject: string;
  bodyHtml: string | null;
  bodyText: string;
  receivedAt: string;
  isImportant: boolean;
  hasAttachments: boolean;
  attachments: { filename: string; size: number }[];
  tags: { tag: { id: string; name: string; color: string } }[];
}

interface Thread {
  id: string;
  subject: string;
  leadId: string | null;
  lead: { id: string; companyName: string } | null;
  account: { id: string; address: string; mailboxLabel: string | null };
  messages: ThreadMessage[];
}

/**
 * The email reading interface (Part: Email Detail View) — opened from a
 * message row in the unified inbox. Shows the whole conversation (every
 * message in the thread, not just the one clicked), which account it
 * belongs to, and the actions that operate on it: reply, mark important,
 * add to lead.
 */
export function MessageDetailPanel({
  threadId,
  onClose,
  onChanged,
}: {
  threadId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [addingToLead, setAddingToLead] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function load() {
    api
      .getEmailThread(threadId)
      .then((t) => setThread(t as Thread))
      .catch((err) => setError((err as Error).message));
  }

  useEffect(load, [threadId]);

  async function sendReply(messageId: string) {
    setSending(true);
    setError(null);
    try {
      await api.replyToEmail(messageId, { bodyHtml: replyBody });
      setReplyBody("");
      setReplyingTo(null);
      setNotice("Reply sent.");
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function addToLead() {
    setAddingToLead(true);
    setError(null);
    try {
      await api.addEmailThreadToLead(threadId);
      setNotice("Linked to a lead.");
      load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAddingToLead(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30">
      <div className="flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-[var(--line)] bg-[var(--paper)] p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{thread?.subject ?? "Loading…"}</h2>
            {thread && (
              <p className="mt-1 text-xs text-ink/50">
                {thread.account.mailboxLabel || thread.account.address}
              </p>
            )}
          </div>
          <button onClick={onClose} className="shrink-0 text-ink/50 hover:text-ink">
            ✕
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
            {error}
          </div>
        )}
        {notice && (
          <div className="mb-3 rounded-lg border border-[rgb(var(--good-rgb)/0.4)] bg-[rgb(var(--good-rgb)/0.06)] px-3 py-2 text-sm text-good">
            {notice}
          </div>
        )}

        {thread && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {thread.lead ? (
              <Link
                href={`/leads/${thread.lead.id}`}
                className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs text-accent hover:underline"
              >
                Lead: {thread.lead.companyName}
              </Link>
            ) : (
              <button
                onClick={addToLead}
                disabled={addingToLead}
                className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 hover:bg-ink/5 disabled:opacity-50"
              >
                {addingToLead ? "Adding…" : "Add to Leads"}
              </button>
            )}
          </div>
        )}

        <div className="flex flex-col gap-4">
          {thread?.messages.map((m) => (
            <div key={m.id} className="rounded-lg border border-[var(--line)] p-4">
              <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">{m.fromName || m.fromEmail}</div>
                  <div className="text-xs text-ink/50">{m.fromEmail}</div>
                  <div className="text-xs text-ink/50">To: {m.toEmails.join(", ")}</div>
                  {m.ccEmails.length > 0 && <div className="text-xs text-ink/50">Cc: {m.ccEmails.join(", ")}</div>}
                </div>
                <div className="text-right text-xs text-ink/50">
                  {new Date(m.receivedAt).toLocaleString()}
                  {m.isImportant && <div className="mt-1 text-gold">★ Important</div>}
                </div>
              </div>
              {m.tags.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1">
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
              )}
              {m.hasAttachments && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {m.attachments.map((a, i) => (
                    <span key={i} className="rounded bg-ink/5 px-2 py-0.5 text-[11px] text-ink/70">
                      📎 {a.filename} ({Math.round(a.size / 1024)} KB)
                    </span>
                  ))}
                </div>
              )}
              {m.bodyHtml ? (
                <iframe
                  sandbox=""
                  className="h-64 w-full rounded border border-[var(--line)] bg-white"
                  srcDoc={m.bodyHtml}
                />
              ) : (
                <p className="whitespace-pre-wrap text-sm text-ink/80">{m.bodyText}</p>
              )}

              <div className="mt-3">
                {replyingTo === m.id ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                      rows={5}
                      placeholder={`Reply to ${m.fromEmail}…`}
                      className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => sendReply(m.id)}
                        disabled={sending || !replyBody.trim()}
                        className="rounded-md bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-50"
                      >
                        {sending ? "Sending…" : "Send reply"}
                      </button>
                      <button
                        onClick={() => setReplyingTo(null)}
                        className="rounded-md border border-[var(--line)] px-3 py-1.5 text-xs text-ink/70 hover:bg-ink/5"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setReplyingTo(m.id)}
                    className="rounded-md border border-[var(--line)] px-3 py-1.5 text-xs text-ink/70 hover:bg-ink/5"
                  >
                    Reply
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
