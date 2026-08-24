"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api-client";

interface Account {
  id: string;
  address: string;
  mailboxLabel: string | null;
}

interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface Grant {
  userId: string;
  accountId: string;
  canReply: boolean;
  user: { id: string; name: string; email: string; role: string };
}

/**
 * Per-account access control (Part: User Access & Permissions) — who can
 * see and reply from each mailbox in the Email Hub. Admins always see every
 * account regardless of grants (EmailHubService.accessibleAccountIds); this
 * is only for restricting everyone else. Absence of a grant row means no
 * access at all, not read-only — see the EmailAccountAccess model comment.
 */
export function EmailHubAccessSection() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [addUserId, setAddUserId] = useState("");
  const [addCanReply, setAddCanReply] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getEmailHubAccounts().then((a) => setAccounts(a as Account[])).catch(() => {});
    api.getUsers().then((u) => setMembers(u as TeamMember[])).catch(() => {});
  }, []);

  function loadGrants(accountId: string) {
    api
      .getEmailAccountAccess(accountId)
      .then((g) => setGrants(g as Grant[]))
      .catch((err) => setError((err as Error).message));
  }

  function toggleExpand(accountId: string) {
    if (expandedId === accountId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(accountId);
    setAddUserId("");
    loadGrants(accountId);
  }

  async function grant(accountId: string) {
    if (!addUserId) return;
    setBusy(true);
    setError(null);
    try {
      await api.grantEmailAccountAccess(accountId, { userId: addUserId, canReply: addCanReply });
      setAddUserId("");
      loadGrants(accountId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(accountId: string, userId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.revokeEmailAccountAccess(accountId, userId);
      loadGrants(accountId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (accounts.length === 0) return null;

  return (
    <section className="rounded-xl border border-[var(--line)] p-5">
      <h2 className="mb-1 text-sm font-semibold tracking-tight">Email Hub access</h2>
      <p className="mb-4 text-xs text-ink/50">
        Admins can always see every inbox-synced mailbox. Everyone else only sees the mailboxes granted here — no
        grant means no access, not read-only.
      </p>

      {error && (
        <div className="mb-3 rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {accounts.map((a) => (
          <div key={a.id} className="rounded-lg border border-[var(--line)]">
            <button
              type="button"
              onClick={() => toggleExpand(a.id)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-ink/5"
            >
              <span>{a.mailboxLabel || a.address}</span>
              <span className="text-xs text-ink/50">{expandedId === a.id ? "Hide" : "Manage access"}</span>
            </button>
            {expandedId === a.id && (
              <div className="border-t border-[var(--line)] p-3">
                <div className="mb-3 flex flex-col gap-1.5">
                  {grants.length === 0 && <p className="text-xs text-ink/50">No one granted yet (besides Admins).</p>}
                  {grants.map((g) => (
                    <div key={g.userId} className="flex items-center justify-between rounded border border-[var(--line)] px-2.5 py-1.5 text-xs">
                      <span>
                        {g.user.name} <span className="text-ink/50">({g.user.email}, {g.user.role})</span>
                        {!g.canReply && <span className="ml-2 text-ink/40">view only</span>}
                      </span>
                      <button
                        disabled={busy}
                        onClick={() => revoke(a.id, g.userId)}
                        className="text-bad hover:underline disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={addUserId}
                    onChange={(e) => setAddUserId(e.target.value)}
                    className="rounded border border-[var(--line)] bg-transparent px-2 py-1.5 text-xs"
                  >
                    <option value="">Select a team member…</option>
                    {members
                      .filter((m) => !grants.some((g) => g.userId === m.id))
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.email})
                        </option>
                      ))}
                  </select>
                  <label className="flex items-center gap-1.5 text-xs text-ink/70">
                    <input type="checkbox" checked={addCanReply} onChange={(e) => setAddCanReply(e.target.checked)} />
                    Can reply
                  </label>
                  <button
                    disabled={busy || !addUserId}
                    onClick={() => grant(a.id)}
                    className="rounded-md bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-50"
                  >
                    Grant access
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
