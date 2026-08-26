"use client";

import { useEffect, useState } from "react";
import { api } from "../../../../lib/api-client";
import { SectionCard } from "../../../../components/chart-kit";

const PLATFORMS = ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "X", "TIKTOK", "YOUTUBE"] as const;
type Platform = (typeof PLATFORMS)[number];

interface Capabilities {
  publish: boolean;
  nativeScheduling: boolean;
  analytics: boolean;
  comments: boolean;
  dms: boolean;
  mediaTypes: string[];
  notes: string;
}

interface Account {
  id: string;
  platform: Platform;
  username: string;
  displayName: string | null;
  status: "CONNECTED" | "EXPIRED" | "DISCONNECTED" | "ERROR";
  connected: boolean;
  capabilities: Capabilities;
  lastPublishError: string | null;
}

const EMPTY_DRAFT = { platform: "INSTAGRAM" as Platform, username: "", displayName: "" };

interface PendingCandidate {
  externalAccountId: string;
  username: string;
  displayName: string | null;
  profileImageUrl: string | null;
  accountType: string | null;
}

function StatusBadge({ status }: { status: Account["status"] }) {
  const tone =
    status === "CONNECTED" ? "bg-good/15 text-good" : status === "EXPIRED" || status === "ERROR" ? "bg-bad/15 text-bad" : "bg-ink/8 text-ink/50";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${tone}`}>{status}</span>;
}

/**
 * Account connection UI (Part: Connect & Manage Accounts). Every platform is
 * shown honestly via the capability registry — no account here can actually
 * publish until real OAuth credentials exist for its platform (Part 32/38's
 * explicit "do not fake it" requirement); "Connect" always attempts the real
 * OAuth redirect and surfaces whatever error the platform/config returns
 * rather than pretending success.
 */
export default function SocialAccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingPlatform, setPendingPlatform] = useState<Platform | null>(null);
  const [pendingCandidates, setPendingCandidates] = useState<PendingCandidate[] | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);

  function refresh() {
    api
      .getSocialAccounts()
      .then((res) => setAccounts(res as Account[]))
      .catch((err) => setError((err as Error).message));
  }

  function loadPendingSelection(id: string) {
    api
      .getPendingSocialSelection(id)
      .then((res) => {
        const r = res as { platform: Platform; accounts: PendingCandidate[] };
        setPendingPlatform(r.platform);
        setPendingCandidates(r.accounts);
      })
      .catch((err) => {
        setError((err as Error).message);
        setPendingId(null);
      });
  }

  useEffect(() => {
    refresh();
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("social_connected");
    const connectError = params.get("social_connect_error");
    const pending = params.get("social_pending");
    if (connected) setNotice(`${connected} connected successfully.`);
    if (connectError) setError(connectError);
    if (pending) {
      setPendingId(pending);
      loadPendingSelection(pending);
    }
    if (connected || connectError || pending) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  async function selectPendingAccount(candidate: PendingCandidate) {
    if (!pendingId) return;
    setSelectingId(candidate.externalAccountId);
    setError(null);
    try {
      await api.selectPendingSocialAccount(pendingId, candidate.externalAccountId);
      setNotice(`${candidate.username} connected successfully.`);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSelectingId(null);
    }
  }

  async function addAccount(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.createSocialAccount({
        platform: draft.platform,
        username: draft.username,
        displayName: draft.displayName || undefined,
      });
      setDraft(EMPTY_DRAFT);
      setShowForm(false);
      setNotice("Account added. Click Connect to authorize it.");
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function connect(account: Account) {
    setBusyId(account.id);
    setError(null);
    try {
      const { url } = await api.connectSocialAccount(account.platform);
      window.location.href = url;
    } catch (err) {
      setError((err as Error).message);
      setBusyId(null);
    }
  }

  async function disconnect(account: Account) {
    setBusyId(account.id);
    setError(null);
    try {
      await api.disconnectSocialAccount(account.id);
      setNotice(`${account.username} disconnected.`);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Accounts</h1>
          <p className="mt-0.5 text-xs text-ink/50">
            Connect one row per platform account. Per-account defaults and access grants live in{" "}
            <a href="/settings/social-media" className="text-accent hover:underline">
              Settings
            </a>
            .
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5"
        >
          {showForm ? "Cancel" : "Add account"}
        </button>
      </div>

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

      {pendingId && pendingCandidates && pendingCandidates.length > 0 && (
        <SectionCard title={`Choose which ${pendingPlatform ?? ""} account${pendingCandidates.length > 1 ? "s" : ""} to connect`}>
          <p className="mb-3 text-xs text-ink/55">
            This login can manage {pendingCandidates.length} account{pendingCandidates.length > 1 ? "s" : ""}. Connect as many
            as you need, one at a time.
          </p>
          <div className="flex flex-col gap-2">
            {pendingCandidates.map((c) => (
              <div key={c.externalAccountId} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] px-3 py-2">
                <div className="flex items-center gap-2">
                  {c.profileImageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.profileImageUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                  )}
                  <div>
                    <div className="text-sm font-medium">{c.displayName || c.username}</div>
                    {c.displayName && <div className="text-xs text-ink/50">{c.username}</div>}
                  </div>
                </div>
                <button
                  disabled={selectingId === c.externalAccountId}
                  onClick={() => selectPendingAccount(c)}
                  className="rounded-md bg-accent px-2.5 py-1 text-xs text-white disabled:opacity-50"
                >
                  {selectingId === c.externalAccountId ? "Connecting…" : "Connect"}
                </button>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {showForm && (
        <SectionCard title="Add account">
          <form onSubmit={addAccount} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="block">
              <span className="mb-1 block text-xs text-ink/60">Platform</span>
              <select
                value={draft.platform}
                onChange={(e) => setDraft((d) => ({ ...d, platform: e.target.value as Platform }))}
                className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
              >
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-ink/60">Handle / username *</span>
              <input
                required
                value={draft.username}
                onChange={(e) => setDraft((d) => ({ ...d, username: e.target.value }))}
                placeholder="@brand"
                className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-ink/60">Internal label</span>
              <input
                value={draft.displayName}
                onChange={(e) => setDraft((d) => ({ ...d, displayName: e.target.value }))}
                placeholder="optional"
                className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={saving || !draft.username.trim()}
              className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {saving ? "Adding…" : "Add"}
            </button>
          </form>
        </SectionCard>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.map((a) => (
          <div key={a.id} className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-ink/45">{a.platform}</div>
                <div className="text-sm font-semibold">{a.displayName || a.username}</div>
                {a.displayName && <div className="text-xs text-ink/50">{a.username}</div>}
              </div>
              <StatusBadge status={a.status} />
            </div>

            <p className="mt-2 text-xs text-ink/55" title={a.capabilities.notes}>
              {a.capabilities.notes.length > 130 ? `${a.capabilities.notes.slice(0, 130)}…` : a.capabilities.notes}
            </p>

            {a.lastPublishError && (
              <p className="mt-2 rounded-md bg-bad/10 px-2 py-1 text-xs text-bad" title={a.lastPublishError}>
                Last publish failed: {a.lastPublishError.length > 90 ? `${a.lastPublishError.slice(0, 90)}…` : a.lastPublishError}
              </p>
            )}

            <div className="mt-2 flex flex-wrap gap-1">
              {[
                ["Publish", a.capabilities.publish],
                ["Native scheduling", a.capabilities.nativeScheduling],
                ["Analytics", a.capabilities.analytics],
                ["Comments", a.capabilities.comments],
                ["DMs", a.capabilities.dms],
              ].map(([label, on]) => (
                <span
                  key={label as string}
                  className={`rounded px-1.5 py-0.5 text-[10px] ${on ? "bg-good/10 text-good" : "bg-ink/6 text-ink/35 line-through"}`}
                >
                  {label as string}
                </span>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              {a.connected ? (
                <button
                  disabled={busyId === a.id}
                  onClick={() => disconnect(a)}
                  className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  disabled={busyId === a.id}
                  onClick={() => connect(a)}
                  className="rounded-md bg-accent px-2.5 py-1 text-xs text-white disabled:opacity-50"
                >
                  {busyId === a.id ? "Redirecting…" : "Connect"}
                </button>
              )}
            </div>
          </div>
        ))}
        {accounts.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-ink/50">
            No accounts yet. Click &quot;Add account&quot; to add your first platform account.
          </p>
        )}
      </div>
    </div>
  );
}
