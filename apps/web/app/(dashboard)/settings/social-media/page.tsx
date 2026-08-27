"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../../lib/api-client";

interface Account {
  id: string;
  platform: string;
  username: string;
  displayName: string | null;
  status: string;
  externalAccountId: string | null;
  tokenExpiresAt: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  createdAt: string;
  defaultTimezone: string | null;
  defaultHashtags: string[];
  defaultCta: string | null;
  brandVoice: string | null;
  approvalRequired: boolean;
}

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface Grant {
  userId: string;
  accountId: string;
  canView: boolean;
  canPublish: boolean;
  canApprove: boolean;
  user: { id: string; name: string; email: string; role: string };
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

/** "valid" / "expiring soon" (< 7 days) / "expired" — a static OAuth token
 *  with no expiry (tokenExpiresAt null but connected) reads as "valid"
 *  since not every platform's token actually expires. */
function tokenStatus(account: Account): { label: string; className: string } {
  if (account.status !== "CONNECTED") return { label: "not connected", className: "text-ink/40" };
  if (!account.tokenExpiresAt) return { label: "valid", className: "text-good" };
  const msLeft = new Date(account.tokenExpiresAt).getTime() - Date.now();
  if (msLeft <= 0) return { label: "expired", className: "text-bad" };
  if (msLeft < 7 * 24 * 60 * 60 * 1000) return { label: "expiring soon", className: "text-gold" };
  return { label: "valid", className: "text-good" };
}

/**
 * Social Media Settings — account-level defaults and per-user access grants,
 * split out from the day-to-day `/social-media` pages the same way Email
 * Hub's settings are (Part: Settings per module — the user's explicit
 * instruction to split settings by module rather than one flat page).
 */
export default function SocialMediaSettingsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Account>>({});
  const [grants, setGrants] = useState<Grant[]>([]);
  const [addUserId, setAddUserId] = useState("");
  const [addCanView, setAddCanView] = useState(true);
  const [addCanPublish, setAddCanPublish] = useState(true);
  const [addCanApprove, setAddCanApprove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function refresh() {
    api.getSocialSettingsAccounts().then((a) => setAccounts(a as Account[])).catch((err) => setError((err as Error).message));
  }

  useEffect(() => {
    refresh();
    api.getUsers().then((u) => setMembers(u as TeamMember[])).catch(() => {});
  }, []);

  function toggleExpand(account: Account) {
    if (expandedId === account.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(account.id);
    setDraft({
      defaultTimezone: account.defaultTimezone ?? "",
      defaultHashtags: account.defaultHashtags,
      defaultCta: account.defaultCta ?? "",
      brandVoice: account.brandVoice ?? "",
      approvalRequired: account.approvalRequired,
    });
    api.getSocialAccountAccess(account.id).then((g) => setGrants(g as Grant[])).catch((err) => setError((err as Error).message));
  }

  async function saveDefaults(accountId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.updateSocialAccountSettings(accountId, draft);
      setNotice("Saved.");
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(accountId: string) {
    if (!confirm("Disconnect this account? It will need to be reconnected via OAuth before it can publish again.")) return;
    setBusy(true);
    try {
      await api.disconnectSocialAccount(accountId);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function subscribeWebhook(accountId: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.subscribeSocialAccountWebhook(accountId);
      setNotice("Webhook subscribed — real-time messages should start arriving in the Social Inbox.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function syncNow(accountId: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.syncSocialInboxAccountNow(accountId);
      setNotice("Synced — existing conversation history should now be visible in the Social Inbox.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount(account: Account) {
    if (
      !confirm(
        `Permanently delete ${account.platform} — ${account.displayName || account.username}? This removes the account, its Social Inbox conversations, and access grants. Past posts are kept but lose their link to this account. This cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteSocialAccount(account.id);
      setExpandedId(null);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function grant(accountId: string) {
    if (!addUserId) return;
    setBusy(true);
    setError(null);
    try {
      await api.grantSocialAccountAccess(accountId, { userId: addUserId, canView: addCanView, canPublish: addCanPublish, canApprove: addCanApprove });
      setAddUserId("");
      api.getSocialAccountAccess(accountId).then((g) => setGrants(g as Grant[]));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(accountId: string, userId: string) {
    setBusy(true);
    try {
      await api.revokeSocialAccountAccess(accountId, userId);
      api.getSocialAccountAccess(accountId).then((g) => setGrants(g as Grant[]));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/settings" className="text-xs text-accent hover:underline">
          ← General settings
        </Link>
        <h1 className="mt-1 text-lg font-semibold tracking-tight">Social Media Settings</h1>
        <p className="mt-0.5 text-xs text-ink/50">
          Per-account defaults, approval requirements, and who can publish or approve. Adding and connecting
          accounts happens on the{" "}
          <Link href="/social-media/accounts" className="text-accent hover:underline">
            Accounts
          </Link>{" "}
          page.
        </p>
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

      <div className="flex flex-col gap-2">
        {accounts.map((a) => (
          <div key={a.id} className="rounded-xl border border-[var(--line)]">
            <button
              type="button"
              onClick={() => toggleExpand(a)}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-ink/5"
            >
              <span>
                {a.platform} — {a.displayName || a.username} <span className="text-xs text-ink/45">({a.status})</span>
              </span>
              <span className="text-xs text-ink/50">{expandedId === a.id ? "Hide" : "Manage"}</span>
            </button>
            {expandedId === a.id && (
              <div className="flex flex-col gap-4 border-t border-[var(--line)] p-4">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-[var(--line)] bg-ink/5 p-3 text-xs sm:grid-cols-4">
                  <div>
                    <div className="text-ink/45">External ID</div>
                    <div className="truncate">{a.externalAccountId || "—"}</div>
                  </div>
                  <div>
                    <div className="text-ink/45">Token status</div>
                    <div className={tokenStatus(a).className}>{tokenStatus(a).label}</div>
                  </div>
                  <div>
                    <div className="text-ink/45">Last synced</div>
                    <div>{formatDate(a.lastSyncAt)}</div>
                  </div>
                  <div>
                    <div className="text-ink/45">Connected</div>
                    <div>{formatDate(a.connectedAt)}</div>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs text-ink/60">Default timezone</span>
                    <input
                      value={draft.defaultTimezone ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, defaultTimezone: e.target.value }))}
                      placeholder="e.g. Europe/London"
                      className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-ink/60">Default CTA</span>
                    <input
                      value={draft.defaultCta ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, defaultCta: e.target.value }))}
                      className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="mb-1 block text-xs text-ink/60">Default hashtags</span>
                  <input
                    value={(draft.defaultHashtags ?? []).join(" ")}
                    onChange={(e) => setDraft((d) => ({ ...d, defaultHashtags: e.target.value.split(/\s+/).filter(Boolean) }))}
                    className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-ink/60">Brand voice</span>
                  <textarea
                    value={draft.brandVoice ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, brandVoice: e.target.value }))}
                    rows={2}
                    placeholder="e.g. Direct, confident, no corporate filler"
                    className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.approvalRequired ?? true}
                    onChange={(e) => setDraft((d) => ({ ...d, approvalRequired: e.target.checked }))}
                  />
                  Require approval before scheduling posts on this account
                </label>
                <div className="flex gap-2">
                  <button disabled={busy} onClick={() => saveDefaults(a.id)} className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-50">
                    Save
                  </button>
                  {a.status === "CONNECTED" && (a.platform === "FACEBOOK" || a.platform === "INSTAGRAM") && (
                    <button
                      disabled={busy}
                      onClick={() => subscribeWebhook(a.id)}
                      className="rounded-md border border-[var(--line)] px-4 py-2 text-sm text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
                      title="Subscribes this account's Page/IG business account to real-time message webhooks. Automatic on future connects -- only needed here for accounts connected before this existed, or to retry after a failure."
                    >
                      Subscribe webhook
                    </button>
                  )}
                  {a.status === "CONNECTED" && (a.platform === "FACEBOOK" || a.platform === "INSTAGRAM") && (
                    <button
                      disabled={busy}
                      onClick={() => syncNow(a.id)}
                      className="rounded-md border border-[var(--line)] px-4 py-2 text-sm text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
                      title="Pulls existing conversation history now instead of waiting for the next scheduled 10-minute sync."
                    >
                      Sync now
                    </button>
                  )}
                  <button disabled={busy} onClick={() => disconnect(a.id)} className="rounded-md border border-bad px-4 py-2 text-sm text-bad disabled:opacity-50">
                    Disconnect
                  </button>
                  <button disabled={busy} onClick={() => deleteAccount(a)} className="rounded-md bg-bad px-4 py-2 text-sm text-white disabled:opacity-50">
                    Delete
                  </button>
                </div>

                <div className="border-t border-[var(--line)] pt-4">
                  <h3 className="mb-2 text-xs font-medium text-ink/70">Access</h3>
                  <div className="mb-3 flex flex-col gap-1.5">
                    {grants.length === 0 && <p className="text-xs text-ink/50">No one granted yet (besides Admins).</p>}
                    {grants.map((g) => (
                      <div key={g.userId} className="flex items-center justify-between rounded border border-[var(--line)] px-2.5 py-1.5 text-xs">
                        <span>
                          {g.user.name} <span className="text-ink/50">({g.user.email})</span>
                          {g.canView && <span className="ml-2 text-accent">view inbox</span>}
                          {g.canPublish && <span className="ml-2 text-good">publish</span>}
                          {g.canApprove && <span className="ml-2 text-gold">approve</span>}
                        </span>
                        <button disabled={busy} onClick={() => revoke(a.id, g.userId)} className="text-bad hover:underline disabled:opacity-50">
                          Revoke
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={addUserId} onChange={(e) => setAddUserId(e.target.value)} className="rounded border border-[var(--line)] bg-transparent px-2 py-1.5 text-xs">
                      <option value="">Select a team member…</option>
                      {members.filter((m) => !grants.some((g) => g.userId === m.id)).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.email})
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1.5 text-xs text-ink/70">
                      <input type="checkbox" checked={addCanView} onChange={(e) => setAddCanView(e.target.checked)} />
                      Can view inbox
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-ink/70">
                      <input type="checkbox" checked={addCanPublish} onChange={(e) => setAddCanPublish(e.target.checked)} />
                      Can publish
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-ink/70">
                      <input type="checkbox" checked={addCanApprove} onChange={(e) => setAddCanApprove(e.target.checked)} />
                      Can approve
                    </label>
                    <button disabled={busy || !addUserId} onClick={() => grant(a.id)} className="rounded-md bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-50">
                      Grant access
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
        {accounts.length === 0 && <p className="py-8 text-center text-sm text-ink/50">No accounts yet.</p>}
      </div>
    </div>
  );
}
