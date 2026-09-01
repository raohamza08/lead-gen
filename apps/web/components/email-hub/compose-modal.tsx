"use client";

import { useState } from "react";
import { api, OutboundAttachmentInput } from "../../lib/api-client";
import { AttachmentPicker } from "./attachment-picker";
import { RichHtmlEditor } from "./rich-html-editor";
import { Modal } from "../ui/modal";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { Checkbox } from "../ui/checkbox";

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
    <Modal open onOpenChange={(o) => !o && onClose()} variant="center" title="New email">
      {error && (
        <div className="mb-3 rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-error">
          {error}
        </div>
      )}
      <form onSubmit={send} className="flex flex-col gap-3">
        <label className="block">
          <span className="mb-1 block text-xs text-ink/60">From</span>
          <Select
            value={accountId}
            onValueChange={setAccountId}
            options={accounts.map((a) => ({ value: a.id, label: a.mailboxLabel || a.address }))}
          />
        </label>
        <label className="block">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs text-ink/60">To (comma-separated)</span>
            <div className="flex items-center gap-2 text-[11px]">
              {!showCc && (
                <button type="button" onClick={() => setShowCc(true)} className="text-ink/40 transition-colors duration-fast hover:text-primary">
                  Cc
                </button>
              )}
              {!showBcc && (
                <button type="button" onClick={() => setShowBcc(true)} className="text-ink/40 transition-colors duration-fast hover:text-primary">
                  Bcc
                </button>
              )}
            </div>
          </div>
          <Input value={to} onChange={(e) => setTo(e.target.value)} required />
        </label>
        {showCc && (
          <label className="block">
            <span className="mb-1 block text-xs text-ink/60">Cc</span>
            <Input value={cc} onChange={(e) => setCc(e.target.value)} />
          </label>
        )}
        {showBcc && (
          <label className="block">
            <span className="mb-1 block text-xs text-ink/60">Bcc</span>
            <Input value={bcc} onChange={(e) => setBcc(e.target.value)} />
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-xs text-ink/60">Subject</span>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} required />
        </label>
        <div className="block">
          <span className="mb-1 block text-xs text-ink/60">Message</span>
          <RichHtmlEditor onChange={setBodyHtml} placeholder="Write your message…" />
        </div>
        <div className="block">
          <AttachmentPicker attachments={attachments} onChange={setAttachments} onError={setAttachmentError} />
          {attachmentError && <p className="mt-1 text-xs text-error">{attachmentError}</p>}
        </div>
        <div className="flex items-center justify-between">
          <Checkbox
            id="compose-track-open"
            checked={trackOpen}
            onCheckedChange={setTrackOpen}
            label={<span title="Embed an open-tracking pixel in this email">Track email</span>}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            loading={sending}
            disabled={sending || !accountId || !bodyHtml.replace(/<[^>]+>/g, "").trim() || !!attachmentError}
          >
            Send
          </Button>
        </div>
      </form>
    </Modal>
  );
}
