"use client";

import { useState } from "react";
import type { OutboundAttachmentInput } from "../../lib/api-client";
import { AttachmentPicker } from "./attachment-picker";
import { RichHtmlEditor } from "./rich-html-editor";

function parseAddressList(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The inline reply box under a thread message — To is fixed (the backend
 * derives it from the message being replied to; see EmailHubService.reply),
 * Cc/Bcc are hidden behind toggle links until needed (Gmail's pattern),
 * formatting goes through RichHtmlEditor, and attachments through
 * AttachmentPicker. `key`-remount this from the parent per message id so
 * the uncontrolled editor resets cleanly between replies.
 */
export function ReplyComposer({
  toAddress,
  initialCc,
  sending,
  onSend,
  onCancel,
}: {
  toAddress: string;
  /** Prefilled when opened via "Reply All"; empty when opened via "Reply". */
  initialCc?: string;
  sending: boolean;
  onSend: (input: { bodyHtml: string; cc: string[]; bcc: string[]; attachments: OutboundAttachmentInput[] }) => void;
  onCancel: () => void;
}) {
  const [bodyHtml, setBodyHtml] = useState("");
  const [cc, setCc] = useState(initialCc ?? "");
  const [bcc, setBcc] = useState("");
  const [showCc, setShowCc] = useState(!!initialCc);
  const [showBcc, setShowBcc] = useState(false);
  const [attachments, setAttachments] = useState<OutboundAttachmentInput[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  const isEmpty = bodyHtml.replace(/<[^>]+>/g, "").trim().length === 0;

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-ink/[0.015] shadow-sm">
      <div className="flex flex-col gap-1.5 border-b border-[var(--line)] px-3.5 py-2.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="w-8 shrink-0 text-ink/40">To</span>
          <span className="truncate text-ink/80">{toAddress}</span>
          <div className="ml-auto flex items-center gap-2 text-[11px]">
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
          <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-ink/40">Cc</span>
            <input
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="comma-separated addresses"
              className="min-w-0 flex-1 bg-transparent text-ink/80 outline-none placeholder:text-ink/30"
            />
          </div>
        )}
        {showBcc && (
          <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-ink/40">Bcc</span>
            <input
              value={bcc}
              onChange={(e) => setBcc(e.target.value)}
              placeholder="comma-separated addresses"
              className="min-w-0 flex-1 bg-transparent text-ink/80 outline-none placeholder:text-ink/30"
            />
          </div>
        )}
      </div>

      <div className="p-3">
        <RichHtmlEditor placeholder={`Reply to ${toAddress}…`} onChange={setBodyHtml} autoFocus />
      </div>

      <div className="flex flex-col gap-2 border-t border-[var(--line)] bg-ink/[0.02] px-3 py-2.5">
        <AttachmentPicker attachments={attachments} onChange={setAttachments} onError={setAttachmentError} />
        {attachmentError && <p className="text-xs text-bad">{attachmentError}</p>}
        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              onSend({ bodyHtml, cc: parseAddressList(cc), bcc: parseAddressList(bcc), attachments })
            }
            disabled={sending || isEmpty || !!attachmentError}
            className="rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send"}
          </button>
          <button
            onClick={onCancel}
            className="rounded-md border border-[var(--line)] px-3 py-1.5 text-xs text-ink/70 hover:bg-ink/5"
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
