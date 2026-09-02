"use client";

import { useState } from "react";
import type { OutboundAttachmentInput } from "../../lib/api-client";
import { AttachmentPicker } from "./attachment-picker";
import { RichHtmlEditor } from "./rich-html-editor";
import { Select } from "../ui/select";

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
 * The inline reply box under a thread message — To is fixed (derived from
 * the message being replied to), Cc/Bcc are hidden behind toggle links
 * until needed (Gmail's pattern), formatting goes through RichHtmlEditor,
 * and attachments through AttachmentPicker. `key`-remount this from the
 * parent per message id so the uncontrolled editor resets cleanly between
 * replies.
 *
 * From (Part: UI/UX Redesign, 2026-09-02) defaults to the account that
 * received the original message — same as before this existed — but is
 * now user-selectable across every connected mailbox, not fixed. Threading
 * (In-Reply-To/References, applied server-side) keys off Message-ID, not
 * sender identity, so replying from a different mailbox still threads
 * correctly for the recipient.
 */
export function ReplyComposer({
  toAddress,
  initialCc,
  accounts,
  defaultAccountId,
  sending,
  onSend,
  onCancel,
}: {
  toAddress: string;
  /** Prefilled when opened via "Reply All"; empty when opened via "Reply". */
  initialCc?: string;
  accounts: Account[];
  defaultAccountId: string;
  sending: boolean;
  onSend: (input: {
    bodyHtml: string; cc: string[]; bcc: string[]; attachments: OutboundAttachmentInput[]; trackOpen: boolean; accountId: string;
  }) => void;
  onCancel: () => void;
}) {
  const [accountId, setAccountId] = useState(defaultAccountId);
  const [bodyHtml, setBodyHtml] = useState("");
  const [cc, setCc] = useState(initialCc ?? "");
  const [bcc, setBcc] = useState("");
  const [showCc, setShowCc] = useState(!!initialCc);
  const [showBcc, setShowBcc] = useState(false);
  const [attachments, setAttachments] = useState<OutboundAttachmentInput[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [trackOpen, setTrackOpen] = useState(false);

  const isEmpty = bodyHtml.replace(/<[^>]+>/g, "").trim().length === 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-ink/[0.015] shadow-[var(--shadow-sm)]">
      <div className="flex flex-col gap-2 border-b border-[var(--line)] px-5 py-3.5 text-sm">
        {accounts.length > 1 && (
          <div className="flex items-center gap-3">
            <span className="w-9 shrink-0 text-ink/40">From</span>
            <div className="max-w-xs flex-1">
              <Select
                value={accountId}
                onValueChange={setAccountId}
                options={accounts.map((a) => ({ value: a.id, label: a.mailboxLabel || a.address }))}
              />
            </div>
          </div>
        )}
        <div className="flex items-center gap-3">
          <span className="w-9 shrink-0 text-ink/40">To</span>
          <span className="truncate text-ink/80">{toAddress}</span>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {!showCc && (
              <button onClick={() => setShowCc(true)} className="text-ink/40 hover:text-accent">
                Cc
              </button>
            )}
            {!showBcc && (
              <button onClick={() => setShowBcc(true)} className="text-ink/40 hover:text-accent">
                Bcc
              </button>
            )}
          </div>
        </div>
        {showCc && (
          <div className="flex items-center gap-3">
            <span className="w-9 shrink-0 text-ink/40">Cc</span>
            <input
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="comma-separated addresses"
              className="min-w-0 flex-1 bg-transparent text-ink/80 outline-none placeholder:text-ink/30"
            />
          </div>
        )}
        {showBcc && (
          <div className="flex items-center gap-3">
            <span className="w-9 shrink-0 text-ink/40">Bcc</span>
            <input
              value={bcc}
              onChange={(e) => setBcc(e.target.value)}
              placeholder="comma-separated addresses"
              className="min-w-0 flex-1 bg-transparent text-ink/80 outline-none placeholder:text-ink/30"
            />
          </div>
        )}
      </div>

      <div className="p-4">
        <RichHtmlEditor placeholder={`Reply to ${toAddress}…`} onChange={setBodyHtml} autoFocus />
      </div>

      <div className="flex flex-col gap-3 border-t border-[var(--line)] bg-ink/[0.02] px-5 py-4">
        <AttachmentPicker attachments={attachments} onChange={setAttachments} onError={setAttachmentError} />
        {attachmentError && <p className="text-sm text-bad">{attachmentError}</p>}
        <label className="flex items-center gap-1.5 text-sm text-ink/60" title="Embed an open-tracking pixel in this email">
          <input type="checkbox" checked={trackOpen} onChange={(e) => setTrackOpen(e.target.checked)} />
          Track email
        </label>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() =>
              onSend({ bodyHtml, cc: parseAddressList(cc), bcc: parseAddressList(bcc), attachments, trackOpen, accountId })
            }
            disabled={sending || isEmpty || !!attachmentError}
            className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-white shadow-[var(--shadow-sm)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send"}
          </button>
          <button
            onClick={onCancel}
            className="rounded-full border border-[var(--line)] px-4 py-2 text-sm text-ink/70 hover:bg-ink/5"
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
