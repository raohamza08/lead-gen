"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../lib/api-client";

interface Account {
  id: string;
  address: string;
  mailboxLabel: string | null;
  inboundSyncEnabled: boolean;
  imapConfigured: boolean;
  imapHost: string | null;
  imapPort: number | null;
  imapEncryption: string | null;
  imapUsername: string | null;
  status: "ACTIVE" | "PAUSED" | "SUSPENDED";
}

const EMPTY_DRAFT = {
  address: "",
  mailboxLabel: "",
  inboundSyncEnabled: true,
  imapHost: "",
  imapPort: 993,
  imapEncryption: "SSL" as "SSL" | "STARTTLS" | "NONE",
  imapUsername: "",
  imapPassword: "",
};

/**
 * Email Hub's own account management (Part: Email Account Management) —
 * connects and configures inbound IMAP sync for a mailbox. Every mailbox is
 * still one EmailAccount row shared with outbound sending (see
 * email-accounts-section.tsx), so this section edits the same records
 * through the same API, just scoped to the fields that matter for reading a
 * mailbox rather than sending from it. Deleting a mailbox outright stays in
 * the Lead Generation settings' account manager, since that also removes
 * its sending config — this section only offers turning sync on/off.
 */
export function EmailHubAccountsSection() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  function refresh() {
    api
      .getEmailAccountsHealth()
      .then((res) => setAccounts(res as Account[]))
      .catch((err) => setError((err as Error).message));
  }

  useEffect(refresh, []);

  const set = <K extends keyof typeof EMPTY_DRAFT>(key: K, value: (typeof EMPTY_DRAFT)[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  async function saveAccount(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const body: Record<string, unknown> = {
        mailboxLabel: draft.mailboxLabel,
        inboundSyncEnabled: draft.inboundSyncEnabled,
        imapHost: draft.imapHost,
        imapPort: draft.imapPort,
        imapEncryption: draft.imapEncryption,
        imapUsername: draft.imapUsername,
      };
      if (draft.imapPassword || !editingId) body.imapPassword = draft.imapPassword;

      if (editingId) {
        await api.updateEmailAccount(editingId, body);
      } else {
        // `provider` picks the outbound send transport, irrelevant to
        // reading a mailbox — defaulted silently since it's schema-required
        // on EmailAccount. Someone who also wants to send from this address
        // sets the real provider from Lead Generation Settings' Email
        // accounts section, same row.
        await api.createEmailAccount({ ...body, provider: "SMTP", address: draft.address });
      }
      setDraft(EMPTY_DRAFT);
      setEditingId(null);
      setShowForm(false);
      setNotice(editingId ? "Mailbox updated." : "Mailbox connected.");
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(account: Account) {
    setEditingId(account.id);
    setDraft({
      address: account.address,
      mailboxLabel: account.mailboxLabel ?? "",
      inboundSyncEnabled: account.inboundSyncEnabled,
      imapHost: account.imapHost ?? "",
      imapPort: account.imapPort ?? 993,
      imapEncryption: (account.imapEncryption as typeof EMPTY_DRAFT.imapEncryption) ?? "SSL",
      imapUsername: account.imapUsername ?? "",
      imapPassword: "",
    });
    setShowForm(true);
  }

  async function toggleSync(account: Account) {
    setBusyId(account.id);
    setError(null);
    try {
      await api.updateEmailAccount(account.id, { inboundSyncEnabled: !account.inboundSyncEnabled });
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rounded-xl border border-[var(--line)] p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Connected mailboxes</h2>
          <p className="mt-0.5 text-xs text-ink/50">
            IMAP sync into the unified inbox. Sending config for outreach lives in{" "}
            <Link href="/settings/lead-generation" className="text-accent hover:underline">
              Lead Generation Settings
            </Link>
            , same underlying mailbox either way.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (showForm) {
              setDraft(EMPTY_DRAFT);
              setEditingId(null);
            }
            setShowForm((v) => !v);
          }}
          className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5"
        >
          {showForm ? "Cancel" : "Add mailbox"}
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

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-ink/55">
            <tr className="border-b border-[var(--line)]">
              <th className="py-2 pr-3">Address</th>
              <th className="py-2 pr-3">Label</th>
              <th className="py-2 pr-3">IMAP</th>
              <th className="py-2 pr-3">Sync</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className="border-b border-[var(--line)] last:border-0">
                <td className="py-2 pr-3">{a.address}</td>
                <td className="py-2 pr-3 text-ink/60">
                  {a.mailboxLabel || <span className="text-ink/35">—</span>}
                </td>
                <td className="py-2 pr-3 text-xs text-ink/60">
                  {a.imapConfigured ? "Configured" : "Not configured"}
                </td>
                <td className="py-2 pr-3">
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      a.inboundSyncEnabled ? "bg-good/20 text-good" : "bg-ink/10 text-ink/50"
                    }`}
                  >
                    {a.inboundSyncEnabled ? "On" : "Off"}
                  </span>
                </td>
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <button
                      disabled={busyId === a.id}
                      onClick={() => startEdit(a)}
                      className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
                    >
                      Edit
                    </button>
                    {a.imapConfigured && (
                      <button
                        disabled={busyId === a.id}
                        onClick={() => toggleSync(a)}
                        className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
                      >
                        {a.inboundSyncEnabled ? "Disable sync" : "Enable sync"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-sm text-ink/50">
                  No mailboxes yet. Add one here, or configure IMAP on an existing mailbox from Lead
                  Generation Settings.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <form onSubmit={saveAccount} className="mt-4 flex flex-col gap-3 border-t border-[var(--line)] pt-4">
          <h3 className="text-xs font-medium text-ink/70">
            {editingId ? "Edit mailbox" : "Connect a mailbox"}
          </h3>

          {!editingId && (
            <label className="block">
              <span className="mb-1 block text-xs text-ink/60">Mailbox address *</span>
              <input
                type="email"
                required
                value={draft.address}
                onChange={(e) => set("address", e.target.value)}
                placeholder="support@yourcompany.com"
                className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
              />
            </label>
          )}

          <label className="block">
            <span className="mb-1 block text-xs text-ink/60">Internal label (shown in Email Hub only)</span>
            <input
              value={draft.mailboxLabel}
              onChange={(e) => set("mailboxLabel", e.target.value)}
              placeholder="e.g. Support inbox — leave blank to show the address"
              className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-ink/60">IMAP host</span>
              <input
                value={draft.imapHost}
                onChange={(e) => set("imapHost", e.target.value)}
                placeholder="imap.gmail.com"
                className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs text-ink/60">Port</span>
                <input
                  type="number"
                  value={draft.imapPort}
                  onChange={(e) => set("imapPort", Number(e.target.value))}
                  className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ink/60">Encryption</span>
                <select
                  value={draft.imapEncryption}
                  onChange={(e) => set("imapEncryption", e.target.value as typeof draft.imapEncryption)}
                  className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                >
                  <option value="SSL">SSL</option>
                  <option value="STARTTLS">STARTTLS</option>
                  <option value="NONE">None</option>
                </select>
              </label>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-ink/60">IMAP username</span>
              <input
                value={draft.imapUsername}
                onChange={(e) => set("imapUsername", e.target.value)}
                placeholder="usually the full email address"
                className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-ink/60">IMAP password / app password</span>
              <input
                type="password"
                value={draft.imapPassword}
                onChange={(e) => set("imapPassword", e.target.value)}
                placeholder={editingId ? "Leave blank to keep the current password" : "Gmail/Workspace: use an app password"}
                className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.inboundSyncEnabled}
              onChange={(e) => set("inboundSyncEnabled", e.target.checked)}
            />
            Sync this mailbox into the Email Hub
          </label>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving || (!editingId && !draft.address.trim())}
              className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : editingId ? "Save changes" : "Connect mailbox"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(EMPTY_DRAFT);
                setEditingId(null);
                setShowForm(false);
              }}
              className="rounded-md border border-[var(--line)] px-4 py-2 text-sm text-ink/70"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
