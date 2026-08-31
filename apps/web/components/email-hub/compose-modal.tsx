"use client";

import { useState } from "react";
import { api, OutboundAttachmentInput } from "../../lib/api-client";
import { AttachmentPicker } from "./attachment-picker";
import { RichHtmlEditor } from "./rich-html-editor";

interface Account {
  id: string;
  address: string;
  mailboxLabel: string | null;
}

function parseAddressList(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * New-email compose (Part: Sending Emails' "manually select another
 * connected account" case — the reply path resolves the account
 * automatically instead, see MessageDetailPanel). Sends through
 * TransactionalEmailService.sendFromAccount via POST /email-hub/compose,
 * same as a reply — no outreach-sequence machinery involved.
 */
export function ComposeModal({
  accounts,
  defaultAccountId,
  onClose,
  onSent,
}: {
  accounts: Account[];
  defaultAccountId?: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [accountId, setAccountId] = useState(defaultAccountId ?? accounts[0]?.id ?? "");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [attachments, setAttachments] = useState<OutboundAttachmentInput[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [trackOpen, setTrackOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      await api.composeEmail({
        accountId,
        to: parseAddressList(to),
        cc: parseAddressList(cc),
        bcc: parseAddressList(bcc),
        subject,
        bodyHtml,
        attachments,
        trackOpen,
      });
      onSent();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-lg p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">New email</h2>
          <button onClick={onClose} className="text-ink/50 hover:text-ink">
            ✕
          </button>
        </div>
        {error && (
          <div className="mb-3 rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
            {error}
          </div>
        )}
        <form onSubmit={send} className="flex flex-col gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-ink/60">From</span>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.mailboxLabel || a.address}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-ink/60">To (comma-separated)</span>
              <div className="flex items-center gap-2 text-[11px]">
                {!showCc && (
                  <button type="button" onClick={() => setShowCc(true)} className="text-ink/40 hover:text-accent">
                    Cc
                  </button>
                )}
                {!showBcc && (
                  <button type="button" onClick={() => setShowBcc(true)} className="text-ink/40 hover:text-accent">
                    Bcc
                  </button>
                )}
              </div>
            </div>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              required
              className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
            />
          </label>
          {showCc && (
            <label className="block">
              <span className="mb-1 block text-xs text-ink/60">Cc</span>
              <input
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
              />
            </label>
          )}
          {showBcc && (
            <label className="block">
              <span className="mb-1 block text-xs text-ink/60">Bcc</span>
              <input
                value={bcc}
                onChange={(e) => setBcc(e.target.value)}
                className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
              />
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-xs text-ink/60">Subject</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
            />
          </label>
          <div className="block">
            <span className="mb-1 block text-xs text-ink/60">Message</span>
            <RichHtmlEditor onChange={setBodyHtml} placeholder="Write your message…" />
          </div>
          <div className="block">
            <AttachmentPicker attachments={attachments} onChange={setAttachments} onError={setAttachmentError} />
            {attachmentError && <p className="mt-1 text-xs text-bad">{attachmentError}</p>}
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-xs text-ink/60" title="Embed an open-tracking pixel in this email">
              <input type="checkbox" checked={trackOpen} onChange={(e) => setTrackOpen(e.target.checked)} />
              Track email
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[var(--line)] px-3 py-1.5 text-xs text-ink/70 hover:bg-ink/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={sending || !accountId || !bodyHtml.replace(/<[^>]+>/g, "").trim() || !!attachmentError}
              className="rounded-md bg-accent px-4 py-1.5 text-xs text-white disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
