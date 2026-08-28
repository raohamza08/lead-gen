"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, OutboundAttachmentInput } from "../../lib/api-client";
import { ReplyComposer } from "./reply-composer";

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
  suggestedCategory: string | null;
  aiSuggestedAction: string | null;
  attachments: { filename: string; size: number }[];
  tags: { tag: { id: string; name: string; color: string } }[];
  folder: string;
}

interface Thread {
  id: string;
  subject: string;
  leadId: string | null;
  lead: { id: string; companyName: string } | null;
  account: { id: string; address: string; mailboxLabel: string | null };
  messages: ThreadMessage[];
}

const AVATAR_PALETTE = [
  "#6366f1",
  "#0891b2",
  "#c026d3",
  "#d97706",
  "#059669",
  "#dc2626",
  "#4f46e5",
  "#0d9488",
];

function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function initials(name: string | null, email: string): string {
  const source = (name || email).trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "🖼️";
  if (ext === "pdf") return "📕";
  if (["doc", "docx"].includes(ext)) return "📝";
  if (["xls", "xlsx", "csv"].includes(ext)) return "📊";
  if (["zip", "rar", "7z"].includes(ext)) return "🗜️";
  return "📎";
}

function formatTimestamp(iso: string): { relative: string; absolute: string } {
  const date = new Date(iso);
  const ms = Date.now() - date.getTime();
  const mins = Math.round(ms / 60000);
  let relative: string;
  if (mins < 1) relative = "just now";
  else if (mins < 60) relative = `${mins}m ago`;
  else if (mins < 60 * 24) relative = `${Math.round(mins / 60)}h ago`;
  else relative = `${Math.round(mins / (60 * 24))}d ago`;
  const absolute = date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return { relative, absolute };
}

/** Grows the sandboxed iframe to fit its content instead of a fixed height
 *  with an inner scrollbar — a message reads like part of the page, not
 *  like an embedded widget. */
function autoSizeIframe(el: HTMLIFrameElement) {
  const doc = el.contentDocument;
  if (!doc?.body) return;
  el.style.height = `${doc.body.scrollHeight + 16}px`;
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
  const [replyMode, setReplyMode] = useState<{ messageId: string; all: boolean } | null>(null);
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
  useEffect(() => setReplyMode(null), [threadId]);

  async function sendReply(
    messageId: string,
    replyAll: boolean,
    input: { bodyHtml: string; cc: string[]; bcc: string[]; attachments: OutboundAttachmentInput[] },
  ) {
    setSending(true);
    setError(null);
    try {
      await api.replyToEmail(messageId, { bodyHtml: input.bodyHtml, replyAll, cc: input.cc, bcc: input.bcc, attachments: input.attachments });
      setReplyMode(null);
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
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-[1px]">
      <div className="animate-slide-in flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-[var(--line)] bg-[var(--paper)] shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--paper)]/95 px-5 py-4 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold tracking-tight text-ink">
                {thread?.subject ?? "Loading…"}
              </h2>
              {thread && (
                <p className="mt-0.5 text-xs text-ink/45">
                  {thread.messages.length} message{thread.messages.length === 1 ? "" : "s"} · {thread.account.mailboxLabel || thread.account.address}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-full p-1.5 text-ink/40 transition-colors hover:bg-ink/10 hover:text-ink"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {thread && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {thread.lead ? (
                <Link
                  href={`/leads/${thread.lead.id}`}
                  className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/15"
                >
                  Lead: {thread.lead.companyName}
                </Link>
              ) : (
                <>
                  {thread.messages[0]?.suggestedCategory === "POSSIBLE_LEAD" && (
                    <span
                      className="rounded-full bg-gold/15 px-2.5 py-1 text-xs text-gold"
                      title={thread.messages[0]?.aiSuggestedAction ?? undefined}
                    >
                      AI flagged this as a possible lead
                    </span>
                  )}
                  <button
                    onClick={addToLead}
                    disabled={addingToLead}
                    className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 hover:bg-ink/5 disabled:opacity-50"
                  >
                    {addingToLead ? "Adding…" : "+ Add to Leads"}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 px-5 py-4">
          {error && (
            <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
              {error}
            </div>
          )}
          {notice && (
            <div className="rounded-lg border border-[rgb(var(--good-rgb)/0.4)] bg-[rgb(var(--good-rgb)/0.06)] px-3 py-2 text-sm text-good">
              {notice}
            </div>
          )}

          {thread?.messages.map((m) => {
            const { relative, absolute } = formatTimestamp(m.receivedAt);
            const sentByUs = m.folder === "SENT";
            return (
              <div
                key={m.id}
                className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper)] shadow-sm"
              >
                <div className="flex items-start gap-3 px-4 pt-4">
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                    style={{ backgroundColor: avatarColor(m.fromEmail) }}
                  >
                    {initials(m.fromName, m.fromEmail)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-ink">{m.fromName || m.fromEmail}</span>
                        {sentByUs && (
                          <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
                            Sent
                          </span>
                        )}
                        {m.isImportant && <span className="text-gold" title="Important">★</span>}
                      </div>
                      <span className="shrink-0 text-xs text-ink/40" title={absolute}>
                        {relative}
                      </span>
                    </div>
                    <p className="truncate text-xs text-ink/45">
                      To: {m.toEmails.join(", ") || "—"}
                      {m.ccEmails.length > 0 && <span> · Cc: {m.ccEmails.join(", ")}</span>}
                    </p>
                  </div>
                </div>

                {m.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1 px-4">
                    {m.tags.map(({ tag }) => (
                      <span
                        key={tag.id}
                        className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                        style={{ backgroundColor: tag.color }}
                      >
                        {tag.name}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mx-4 mt-3 border-t border-[var(--line)]/70" />

                <div className="px-4 py-3">
                  {m.bodyHtml ? (
                    <iframe
                      sandbox=""
                      className="w-full rounded-lg border-0"
                      style={{ height: 120 }}
                      srcDoc={`<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;line-height:1.55;color:#1a1a1a;margin:0;word-wrap:break-word}</style>${m.bodyHtml}`}
                      onLoad={(e) => autoSizeIframe(e.currentTarget)}
                    />
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink/80">{m.bodyText}</p>
                  )}
                </div>

                {m.hasAttachments && (
                  <div className="flex flex-wrap gap-1.5 px-4 pb-3">
                    {m.attachments.map((a, i) => (
                      <span
                        key={i}
                        className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-ink/[0.03] px-2.5 py-1 text-[11px] text-ink/70"
                      >
                        <span>{fileIcon(a.filename)}</span>
                        <span className="max-w-[180px] truncate">{a.filename}</span>
                        <span className="text-ink/40">({formatSize(a.size)})</span>
                      </span>
                    ))}
                  </div>
                )}

                <div className="border-t border-[var(--line)] bg-ink/[0.02] px-4 py-3">
                  {replyMode?.messageId === m.id ? (
                    <ReplyComposer
                      key={m.id}
                      toAddress={m.fromEmail}
                      initialCc={replyMode.all ? m.ccEmails.join(", ") : undefined}
                      sending={sending}
                      onSend={(input) => sendReply(m.id, replyMode.all, input)}
                      onCancel={() => setReplyMode(null)}
                    />
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setReplyMode({ messageId: m.id, all: false })}
                        className="rounded-md border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-ink/70 hover:bg-ink/5"
                      >
                        ↩ Reply
                      </button>
                      {m.ccEmails.length > 0 && (
                        <button
                          onClick={() => setReplyMode({ messageId: m.id, all: true })}
                          className="rounded-md border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-ink/70 hover:bg-ink/5"
                        >
                          ↩↩ Reply All
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
