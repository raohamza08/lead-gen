"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api-client";

interface Account {
  id: string;
  provider: "GMAIL" | "MICROSOFT_365" | "SMTP";
  address: string;
  displayName: string | null;
  status: "ACTIVE" | "PAUSED" | "SUSPENDED";
  /** Explicit opt-in for the outbound rotation — separate from `status`. A
   *  mailbox can be ACTIVE (e.g. just for reading) without ever being used
   *  to send to a lead until this is turned on. */
  sendingEnabled: boolean;
  dailyLimit: number;
  hourlyLimit: number;
  oauthConfigured: boolean;
  smtpConfigured: boolean;
  sentToday: number;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUsername: string | null;
  mailboxLabel: string | null;
  inboundSyncEnabled: boolean;
  imapConfigured: boolean;
  imapHost: string | null;
  imapPort: number | null;
  imapEncryption: string | null;
  imapUsername: string | null;
}

const EMPTY_DRAFT = {
  provider: "SMTP" as "SMTP" | "MICROSOFT_365" | "GMAIL",
  address: "",
  displayName: "",
  dailyLimit: 30,
  hourlyLimit: 5,
  smtpHost: "",
  smtpPort: 587,
  smtpUsername: "",
  smtpPassword: "",
  oauthRefreshToken: "",
  mailboxLabel: "",
  inboundSyncEnabled: true,
  imapHost: "",
  imapPort: 993,
  imapEncryption: "SSL" as "SSL" | "STARTTLS" | "NONE",
  imapUsername: "",
  imapPassword: "",
};

/**
 * Health bar colour follows the same 40/40/20-style thresholds used elsewhere
 * in the dashboard: green while there's clear headroom, gold approaching the
 * limit, red once it's essentially spent.
 */
function barColor(sent: number, limit: number): string {
  if (limit <= 0) return "bg-ink/30";
  const ratio = sent / limit;
  if (ratio >= 0.9) return "bg-bad";
  if (ratio >= 0.6) return "bg-gold";
  return "bg-good";
}

/**
 * The one place every mailbox is set up — sending config (SMTP/OAuth,
 * daily/hourly limits, the sendingEnabled switch) and inbound IMAP sync for
 * the unified inbox, both on the same EmailAccount row. Used to be split
 * across two settings pages (Lead Generation owned sending, Email Hub owned
 * reading); consolidated here per the explicit decision that mailbox setup
 * belongs only in Email Hub Settings — Lead Generation now only reads which
 * mailbox(es) are eligible to send (see sending-mailboxes-section.tsx), it
 * doesn't configure them. This whole page is admin-only (see
 * settings/email-hub/page.tsx's role check) since setup here includes real
 * credentials.
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
  const [reconciling, setReconciling] = useState(false);
  const [resending, setResending] = useState(false);

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
        provider: draft.provider,
        address: draft.address,
        displayName: draft.displayName,
        dailyLimit: draft.dailyLimit,
        hourlyLimit: draft.hourlyLimit,
        mailboxLabel: draft.mailboxLabel,
        inboundSyncEnabled: draft.inboundSyncEnabled,
        imapHost: draft.imapHost,
        imapPort: draft.imapPort,
        imapEncryption: draft.imapEncryption,
        imapUsername: draft.imapUsername,
      };
      // Credential fields the API never echoes back — an untouched blank on
      // edit means "keep the current one," not "clear it." Only sent when
      // actually typed, or always on create.
      if (draft.provider === "GMAIL") {
        if (draft.oauthRefreshToken || !editingId) body.oauthRefreshToken = draft.oauthRefreshToken;
      } else {
        body.smtpHost = draft.smtpHost;
        body.smtpPort = draft.smtpPort;
        body.smtpUsername = draft.smtpUsername;
        if (draft.smtpPassword || !editingId) body.smtpPassword = draft.smtpPassword;
      }
      if (draft.imapPassword || !editingId) body.imapPassword = draft.imapPassword;

      if (editingId) {
        await api.updateEmailAccount(editingId, body);
      } else {
        await api.createEmailAccount(body);
      }
      setDraft(EMPTY_DRAFT);
      setEditingId(null);
      setShowForm(false);
      setNotice(editingId ? "Mailbox updated." : "Mailbox added — turn on Sending below once it's tested.");
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
      provider: account.provider,
      address: account.address,
      displayName: account.displayName ?? "",
      dailyLimit: account.dailyLimit,
      hourlyLimit: account.hourlyLimit,
      smtpHost: account.smtpHost ?? "",
      smtpPort: account.smtpPort ?? 587,
      smtpUsername: account.smtpUsername ?? "",
      smtpPassword: "",
      oauthRefreshToken: "",
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

  async function togglePause(account: Account) {
    setBusyId(account.id);
    setError(null);
    try {
      const status = account.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
      await api.updateEmailAccount(account.id, { status });
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  /** The explicit "use this mailbox for real outreach" switch — off by
   *  default for anything not already sending, so adding a mailbox never
   *  silently pulls it into the rotation before it's actually ready. */
  async function toggleSending(account: Account) {
    setBusyId(account.id);
    setError(null);
    try {
      await api.updateEmailAccount(account.id, { sendingEnabled: !account.sendingEnabled });
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
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

  async function sendTest(account: Account) {
    setBusyId(account.id);
    setError(null);
    setNotice(null);
    try {
      const result = (await api.testEmailAccount(account.id)) as { ok: boolean; sentTo: string; error?: string };
      if (result.ok) {
        setNotice(`Test email sent from ${account.address} to ${result.sentTo}. Check your inbox.`);
      } else {
        setError(`Test send from ${account.address} failed: ${result.error}`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  /** Finds emails stuck showing "queued" whose send actually already died
   *  (e.g. after a mailbox's credentials went bad) and flips them to Failed
   *  so they show up accurately and Resend becomes available. */
  async function reconcileStuck() {
    setReconciling(true);
    setError(null);
    setNotice(null);
    try {
      const result = (await api.reconcileStuckEmails()) as { checked: number; fixed: number };
      setNotice(
        result.fixed > 0
          ? `Found ${result.fixed} email(s) stuck as "queued" that had actually failed — marked them Failed so they can be resent from the lead's page.`
          : "No stuck emails found — everything queued is either sent or genuinely still in flight.",
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setReconciling(false);
    }
  }

  /** Bulk follow-up to fixing a mailbox — none of the emails a bad password
   *  (or other now-resolved problem) failed retry on their own once BullMQ
   *  gives up on a job. */
  async function resendAllFailed() {
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      const result = (await api.resendAllFailedEmails()) as { resent: number };
      setNotice(result.resent > 0 ? `Re-queued ${result.resent} failed email(s) for another send attempt.` : "No failed emails to resend.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResending(false);
    }
  }

  async function deleteAccount(account: Account) {
    if (!window.confirm(`Delete mailbox ${account.address}? Sent/received history is kept, but it stops sending and syncing immediately.`)) return;
    setBusyId(account.id);
    setError(null);
    try {
      await api.deleteEmailAccount(account.id);
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
            Sending config and inbound IMAP sync, both on the same mailbox. A new mailbox never sends to a
            lead until you turn its <strong>Sending</strong> switch on — Lead Generation only shows
            mailboxes that already have it on.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={reconciling}
            onClick={reconcileStuck}
            title="Checks for emails still shown as “queued” whose send already failed for good (e.g. bad mailbox credentials), and marks them Failed so they can be resent."
            className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
          >
            {reconciling ? "Checking…" : "Check for stuck emails"}
          </button>
          <button
            type="button"
            disabled={resending}
            onClick={resendAllFailed}
            title="Re-queues every email currently showing Failed for another send attempt — use this after fixing whatever made them fail (e.g. a mailbox password)."
            className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
          >
            {resending ? "Resending…" : "Resend all failed"}
          </button>
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
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-ink/55">
            <tr className="border-b border-[var(--line)]">
              <th className="py-2 pr-3">Address</th>
              <th className="py-2 pr-3">Shown as</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Sending</th>
              <th className="py-2 pr-3">Sync</th>
              <th className="py-2 pr-3">Sent today</th>
              <th className="py-2 pr-3">Credentials</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className="border-b border-[var(--line)] last:border-0">
                <td className="py-2 pr-3">
                  {a.address}
                  <div className="text-[11px] text-ink/40">{a.mailboxLabel || a.provider}</div>
                </td>
                <td className="py-2 pr-3 text-ink/60">{a.displayName || <span className="text-ink/35">org default</span>}</td>
                <td className="py-2 pr-3">
                  <span className={`rounded px-2 py-0.5 text-xs ${a.status === "ACTIVE" ? "bg-good/20 text-good" : "bg-bad/20 text-bad"}`}>
                    {a.status}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  <button
                    disabled={busyId === a.id}
                    onClick={() => toggleSending(a)}
                    title={a.sendingEnabled ? "Used for real outreach sends. Click to turn off." : "Will never be used to send to a lead until you turn this on."}
                    className={`rounded px-2 py-0.5 text-xs transition-colors disabled:opacity-50 ${
                      a.sendingEnabled ? "bg-good/20 text-good hover:bg-good/30" : "bg-ink/10 text-ink/50 hover:bg-ink/15"
                    }`}
                  >
                    {a.sendingEnabled ? "On" : "Off"}
                  </button>
                </td>
                <td className="py-2 pr-3">
                  <button
                    disabled={busyId === a.id || !a.imapConfigured}
                    onClick={() => toggleSync(a)}
                    title={a.imapConfigured ? "Whether the Email Hub polls this mailbox's inbox." : "Add IMAP settings below to enable sync."}
                    className={`rounded px-2 py-0.5 text-xs transition-colors disabled:opacity-50 ${
                      a.inboundSyncEnabled ? "bg-good/20 text-good hover:bg-good/30" : "bg-ink/10 text-ink/50 hover:bg-ink/15"
                    }`}
                  >
                    {a.inboundSyncEnabled ? "On" : "Off"}
                  </button>
                </td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-ink/10">
                      <div
                        className={`h-full ${barColor(a.sentToday, a.dailyLimit)}`}
                        style={{ width: `${Math.min(100, (a.sentToday / Math.max(1, a.dailyLimit)) * 100)}%` }}
                      />
                    </div>
                    <span className="tabular text-xs text-ink/60">
                      {a.sentToday}/{a.dailyLimit}
                    </span>
                  </div>
                </td>
                <td className="py-2 pr-3 text-xs text-ink/60">
                  {a.oauthConfigured || a.smtpConfigured ? "Send ✓" : "Send ✗"} / {a.imapConfigured ? "IMAP ✓" : "IMAP ✗"}
                </td>
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <button
                      disabled={busyId === a.id}
                      onClick={() => sendTest(a)}
                      className="rounded-md bg-accent px-2.5 py-1 text-xs text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      Send test
                    </button>
                    <button
                      disabled={busyId === a.id}
                      onClick={() => startEdit(a)}
                      className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
                    >
                      Edit
                    </button>
                    <button
                      disabled={busyId === a.id}
                      onClick={() => togglePause(a)}
                      className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
                    >
                      {a.status === "ACTIVE" ? "Pause" : "Resume"}
                    </button>
                    <button
                      disabled={busyId === a.id}
                      onClick={() => deleteAccount(a)}
                      className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-bad transition-colors hover:bg-[rgb(var(--bad-rgb)/0.08)] disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr>
                <td colSpan={8} className="py-6 text-center text-sm text-ink/50">
                  No mailboxes configured. Add one, then use &ldquo;Send test&rdquo; before turning Sending on.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <form onSubmit={saveAccount} className="mt-4 flex flex-col gap-4 border-t border-[var(--line)] pt-4">
          <h3 className="text-xs font-medium text-ink/70">{editingId ? "Edit mailbox" : "New mailbox"}</h3>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-ink/60">Provider</span>
              <select
                value={draft.provider}
                onChange={(e) => set("provider", e.target.value as typeof draft.provider)}
                className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
              >
                <option value="SMTP">SMTP</option>
                <option value="MICROSOFT_365">Microsoft 365</option>
                <option value="GMAIL">Gmail</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-ink/60">Mailbox address *</span>
              <input
                type="email"
                required
                disabled={!!editingId}
                value={draft.address}
                onChange={(e) => set("address", e.target.value)}
                placeholder="outreach@yourcompany.com"
                className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm disabled:opacity-60"
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-ink/60">Display name shown to recipients</span>
              <input
                value={draft.displayName}
                onChange={(e) => set("displayName", e.target.value)}
                placeholder="e.g. EurosHub Sales — leave blank for the org default"
                className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-ink/60">Internal label (Email Hub only)</span>
              <input
                value={draft.mailboxLabel}
                onChange={(e) => set("mailboxLabel", e.target.value)}
                placeholder="leave blank to show the address"
                className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-ink/60">Daily limit</span>
              <input
                type="number"
                min={1}
                value={draft.dailyLimit}
                onChange={(e) => set("dailyLimit", Number(e.target.value))}
                className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-ink/60">Hourly limit</span>
              <input
                type="number"
                min={1}
                value={draft.hourlyLimit}
                onChange={(e) => set("hourlyLimit", Number(e.target.value))}
                className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div className="border-t border-[var(--line)] pt-4">
            <h4 className="mb-2 text-xs font-medium text-ink/70">Sending credentials</h4>
            {draft.provider === "GMAIL" ? (
              <label className="block">
                <span className="mb-1 block text-xs text-ink/60">OAuth refresh token</span>
                <input
                  value={draft.oauthRefreshToken}
                  onChange={(e) => set("oauthRefreshToken", e.target.value)}
                  placeholder={editingId ? "Leave blank to keep the current token" : "Obtained out-of-band — there is no consent flow in the app"}
                  className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                />
              </label>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs text-ink/60">SMTP host</span>
                  <input
                    value={draft.smtpHost}
                    onChange={(e) => set("smtpHost", e.target.value)}
                    placeholder="smtp.gmail.com"
                    className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-ink/60">SMTP port</span>
                  <input
                    type="number"
                    value={draft.smtpPort}
                    onChange={(e) => set("smtpPort", Number(e.target.value))}
                    className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-ink/60">Username</span>
                  <input
                    value={draft.smtpUsername}
                    onChange={(e) => set("smtpUsername", e.target.value)}
                    className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-ink/60">Password / app password</span>
                  <input
                    type="password"
                    value={draft.smtpPassword}
                    onChange={(e) => set("smtpPassword", e.target.value)}
                    placeholder={editingId ? "Leave blank to keep the current password" : undefined}
                    className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                  />
                </label>
              </div>
            )}
          </div>

          <div className="border-t border-[var(--line)] pt-4">
            <h4 className="mb-2 text-xs font-medium text-ink/70">Inbound IMAP sync (Email Hub)</h4>
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
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.inboundSyncEnabled} onChange={(e) => set("inboundSyncEnabled", e.target.checked)} />
              Sync this mailbox into the Email Hub
            </label>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving || !draft.address.trim()}
              className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : editingId ? "Save changes" : "Add mailbox"}
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
