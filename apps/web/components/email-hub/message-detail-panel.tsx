"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, OutboundAttachmentInput, viewEmailAttachment } from "../../lib/api-client";
import { ReplyComposer } from "./reply-composer";
import { Modal, ModalClose, ModalTitle } from "../ui/modal";
import { Button } from "../ui/button";
import { StatusBadge } from "../ui/status-badge";

interface Account {
  id: string;
  address: string;
  mailboxLabel: string | null;
}

interface SentStatus {
  sentAt: string;
  viewedAt: string | null;
  verifiedViewedAt: string | null;
  repliedAt: string | null;
}

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
  isIgnored: boolean;
  hasAttachments: boolean;
  suggestedCategory: string | null;
  aiSuggestedAction: string | null;
  attachments: { filename: string; size: number }[];
  tags: { tag: { id: string; name: string; color: string } }[];
  folder: string;
  sentStatus: SentStatus | null;
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

/** Sent → Viewed → Replied timeline (Part: Email Hub sent-status timeline,
 *  2026-09-02) — replaces the plain static "Sent" badge with the actual
 *  progression, each stage labeled with its exact timestamp (down to the
 *  minute) rather than a relative "1h ago" that goes stale the moment you
 *  glance away. "Viewed" only ever appears for a message sent with "Track
 *  email" checked (no tracking row exists otherwise); a raw-only
 *  (unverified) view is labeled as such rather than presented as a
 *  confirmed open — see EmailHubService.withSentStatus's docblock for why a
 *  raw signal can't always be verified, particularly for Gmail recipients. */
function SentStatusRow({ status }: { status: SentStatus }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <StatusBadge tone="neutral" label={`Sent · ${formatTimestamp(status.sentAt).absolute}`} />
      {status.verifiedViewedAt ? (
        <StatusBadge tone="success" label={`Viewed · ${formatTimestamp(status.verifiedViewedAt).absolute}`} />
      ) : status.viewedAt ? (
        <span title="Pixel fired too soon after sending to rule out prefetching (common for Gmail, which proxies images server-side) — likely not a confirmed human view">
          <StatusBadge tone="warning" label={`Possibly viewed · ${formatTimestamp(status.viewedAt).absolute}`} />
        </span>
      ) : null}
      {status.repliedAt && (
        <StatusBadge tone="accent" label={`Replied · ${formatTimestamp(status.repliedAt).absolute}`} />
      )}
    </div>
  );
}

/** Grows the sandboxed iframe to fit its content instead of a fixed height
 *  with an inner scrollbar — a message reads like part of the page, not
 *  like an embedded widget. Requires the iframe's `sandbox` to include
 *  `allow-same-origin` — without it the srcDoc content gets an opaque
 *  cross-origin, `el.contentDocument` is null, and this silently no-ops,
 *  leaving the iframe stuck at its fallback height with its own scrollbar. */
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
  accounts,
  onClose,
  onChanged,
}: {
  threadId: string;
  accounts: Account[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replyMode, setReplyMode] = useState<{ messageId: string; all: boolean } | null>(null);
  const [sending, setSending] = useState(false);
  const [addingToLead, setAddingToLead] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [openingAttachment, setOpeningAttachment] = useState<string | null>(null);
  const [actioning, setActioning] = useState(false);

  async function openAttachment(messageId: string, index: number, key: string) {
    setOpeningAttachment(key);
    setError(null);
    try {
      await viewEmailAttachment(messageId, index);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOpeningAttachment(null);
    }
  }

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
    input: { bodyHtml: string; cc: string[]; bcc: string[]; attachments: OutboundAttachmentInput[]; trackOpen: boolean; accountId: string },
  ) {
    setSending(true);
    setError(null);
    try {
      await api.replyToEmail(messageId, {
        bodyHtml: input.bodyHtml, replyAll, cc: input.cc, bcc: input.bcc,
        attachments: input.attachments, trackOpen: input.trackOpen, accountId: input.accountId,
      });
      setReplyMode(null);
      setNotice("Reply sent.");
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  /** Applies to every message in the thread — a thread reads as one unit in
   *  the list view, so marking it important/ignored should too, rather than
   *  leaving some of its messages in a different state than the one the
   *  user just acted on. */
  async function applyToThread(action: "IMPORTANT" | "UNIMPORTANT" | "IGNORE" | "UNIGNORE") {
    if (!thread) return;
    setActioning(true);
    setError(null);
    try {
      await api.bulkEmailAction({ messageIds: thread.messages.map((m) => m.id), action });
      load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActioning(false);
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
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      variant="center"
      // The Modal's structural classes always include `p-5` (see modal.tsx) —
      // this content's own `p-0` has the same specificity, so which one
      // "wins" depends on Tailwind's generated CSS order, not source order
      // (documented in modal.tsx's own contentClassName comment). That was
      // leaving a ~20px unpadded gap above the sticky header on this modal
      // specifically, where scrolled message content was visible sliding
      // up past the header's actual top edge. `!p-0` forces the override
      // unconditionally instead of depending on build-order luck.
      contentClassName="w-full max-w-5xl h-[calc(100vh-96px)] bg-paper !p-0"
      bodyClassName="contents"
    >
      {/* will-change-transform + translateZ(0) (Part: email reader header
       *  stacking fix) — without a forced compositor layer, Chrome/Edge
       *  paint each message body's iframe on its own GPU layer that ignores
       *  this header's z-index once the panel scrolls, so the email content
       *  renders on top of the sticky header and covers the close button.
       *  Promoting the header to its own layer restores normal stacking.
       *  Solid bg-paper (not bg-paper/95 + backdrop-blur) is deliberate too —
       *  a translucent header lets scrolled-under email content show through
       *  it, which reads as a floating banner rather than a fixed header
       *  bar; shadow-sm gives it the same separation a border alone can't
       *  once it's fully opaque. */}
      <div className="sticky top-0 z-10 rounded-t-[var(--radius)] border-b border-[var(--line)] bg-paper px-5 py-3 shadow-sm will-change-transform [transform:translateZ(0)]">
        <div className="flex w-full items-start justify-between gap-4">
          <div className="min-w-0">
            <ModalTitle className="truncate text-base font-semibold tracking-tight text-ink">
              {thread?.subject ?? "Loading…"}
            </ModalTitle>
            {thread && (
              <p className="mt-0.5 text-xs text-ink/50">
                {thread.messages.length} message{thread.messages.length === 1 ? "" : "s"} · {thread.account.mailboxLabel || thread.account.address}
              </p>
            )}
          </div>
          <ModalClose
            className="flex shrink-0 h-8 w-8 items-center justify-center rounded-full text-base text-ink/40 transition-colors duration-fast hover:bg-ink/10 hover:text-ink"
            aria-label="Close"
          >
            ✕
          </ModalClose>
        </div>

        {thread && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Button
              variant={thread.messages[0]?.isImportant ? "primary" : "secondary"}
              size="sm"
              onClick={() => applyToThread(thread.messages[0]?.isImportant ? "UNIMPORTANT" : "IMPORTANT")}
              disabled={actioning}
              title="Mark this thread important"
              className={thread.messages[0]?.isImportant ? "!bg-warning !text-white rounded-full" : "rounded-full"}
            >
              {thread.messages[0]?.isImportant ? "★ Important" : "☆ Mark important"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => applyToThread(thread.messages[0]?.isIgnored ? "UNIGNORE" : "IGNORE")}
              disabled={actioning}
              title="Move this thread out of the unified inbox"
              className="rounded-full"
            >
              {thread.messages[0]?.isIgnored ? "Unignore" : "🔇 Ignore"}
            </Button>
            {thread.lead ? (
              <Link
                href={`/leads/${thread.lead.id}`}
                className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors duration-fast hover:bg-primary/15"
              >
                Lead: {thread.lead.companyName}
              </Link>
            ) : (
              <>
                {thread.messages[0]?.suggestedCategory === "POSSIBLE_LEAD" && (
                  <span
                    className="rounded-full bg-warning/15 px-2.5 py-1 text-xs text-warning"
                    title={thread.messages[0]?.aiSuggestedAction ?? undefined}
                  >
                    AI flagged this as a possible lead
                  </span>
                )}
                <Button variant="secondary" size="sm" onClick={addToLead} disabled={addingToLead} loading={addingToLead} className="rounded-full">
                  + Add to Leads
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex w-full flex-col gap-4 px-5 py-4">
        {error && (
          <div className="rounded-xl border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-4 py-2 text-xs text-error">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-xl border border-[rgb(var(--good-rgb)/0.4)] bg-[rgb(var(--good-rgb)/0.06)] px-4 py-2 text-xs text-good">
            {notice}
          </div>
        )}

          {thread?.messages.map((m) => {
            const { relative, absolute } = formatTimestamp(m.receivedAt);
            return (
              <div key={m.id} className="card relative z-0 overflow-hidden">
                <div className="flex items-start gap-3 px-5 pt-4">
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                    style={{ backgroundColor: avatarColor(m.fromEmail) }}
                  >
                    {initials(m.fromName, m.fromEmail)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-ink">{m.fromName || m.fromEmail}</span>
                        {m.isImportant && <span className="text-gold" title="Important">★</span>}
                      </div>
                      <span className="shrink-0 text-xs text-ink/40" title={absolute}>
                        {relative}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-ink/50">
                      To: {m.toEmails.join(", ") || "—"}
                      {m.ccEmails.length > 0 && <span> · Cc: {m.ccEmails.join(", ")}</span>}
                    </p>
                    {m.sentStatus && (
                      <div className="mt-1.5">
                        <SentStatusRow status={m.sentStatus} />
                      </div>
                    )}
                  </div>
                </div>

                {m.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5 px-5">
                    {m.tags.map(({ tag }) => (
                      <span
                        key={tag.id}
                        className="rounded-full px-2.5 py-1 text-xs font-medium text-white"
                        style={{ backgroundColor: tag.color }}
                      >
                        {tag.name}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mx-5 mt-3 border-t border-[var(--line)]/70" />

                <div className="px-5 py-3">
                  {m.bodyHtml ? (
                    <iframe
                      sandbox="allow-same-origin"
                      className="w-full rounded-lg border-0"
                      style={{ height: 120 }}
                      srcDoc={`<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:15.5px;line-height:1.65;color:#1a1a1a;margin:0;word-wrap:break-word}</style>${m.bodyHtml}`}
                      onLoad={(e) => autoSizeIframe(e.currentTarget)}
                    />
                  ) : (
                    <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink/80">{m.bodyText}</p>
                  )}
                </div>

                {m.hasAttachments && (
                  <div className="flex flex-wrap gap-2 px-5 pb-3">
                    {m.attachments.map((a, i) => {
                      const key = `${m.id}:${i}`;
                      const isOpening = openingAttachment === key;
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => openAttachment(m.id, i, key)}
                          disabled={isOpening}
                          title={`View or download ${a.filename}`}
                          className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-ink/[0.03] px-3 py-1.5 text-xs text-ink/70 transition-colors hover:border-accent/40 hover:bg-accent/5 hover:text-accent disabled:opacity-60"
                        >
                          <span>{isOpening ? "⏳" : fileIcon(a.filename)}</span>
                          <span className="max-w-[200px] truncate">{a.filename}</span>
                          <span className="text-ink/40">({formatSize(a.size)})</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="border-t border-[var(--line)] bg-ink/[0.02] px-5 py-3">
                  {replyMode?.messageId === m.id ? (
                    <ReplyComposer
                      key={m.id}
                      toAddress={m.fromEmail}
                      initialCc={replyMode.all ? m.ccEmails.join(", ") : undefined}
                      accounts={accounts}
                      defaultAccountId={thread?.account.id ?? accounts[0]?.id ?? ""}
                      sending={sending}
                      onSend={(input) => sendReply(m.id, replyMode.all, input)}
                      onCancel={() => setReplyMode(null)}
                    />
                  ) : (
                    <div className="flex gap-2.5">
                      <Button variant="secondary" className="rounded-full" onClick={() => setReplyMode({ messageId: m.id, all: false })}>
                        ↩ Reply
                      </Button>
                      {m.ccEmails.length > 0 && (
                        <Button variant="secondary" className="rounded-full" onClick={() => setReplyMode({ messageId: m.id, all: true })}>
                          ↩↩ Reply All
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
    </Modal>
  );
}
