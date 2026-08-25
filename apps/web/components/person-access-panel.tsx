"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api-client";

interface ModuleFlags {
  leadGenAccess: boolean;
  emailHubAccess: boolean;
  socialMediaAccess: boolean;
}

interface EmailAccountRow {
  id: string;
  address: string;
  mailboxLabel: string | null;
  granted: boolean;
  canReply: boolean;
}

interface SocialAccountRow {
  id: string;
  platform: string;
  username: string;
  displayName: string | null;
  granted: boolean;
  canPublish: boolean;
  canApprove: boolean;
}

interface AccessData {
  isAdmin: boolean;
  modules: ModuleFlags;
  emailAccounts: EmailAccountRow[];
  socialAccounts: SocialAccountRow[];
}

const MODULE_LABELS: { key: keyof ModuleFlags; label: string }[] = [
  { key: "leadGenAccess", label: "Lead Generation" },
  { key: "emailHubAccess", label: "Email Hub" },
  { key: "socialMediaAccess", label: "Social Media" },
];

/**
 * Everything one person can touch, in one place (Part: Person Access) —
 * module toggles plus which specific email/social accounts they're granted,
 * read and written from the person's side rather than each account's own
 * settings page. Writes go through the same EmailAccountAccess/
 * SocialAccountAccess rows those account-centric pages already use, so both
 * stay in sync automatically.
 */
export function PersonAccessPanel({ userId }: { userId: string }) {
  const [data, setData] = useState<AccessData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function refresh() {
    api
      .getUserAccess(userId)
      .then((res) => setData(res as AccessData))
      .catch((err) => setError((err as Error).message));
  }

  useEffect(refresh, [userId]);

  function toggleModule(key: keyof ModuleFlags) {
    if (!data || data.isAdmin) return;
    setData({ ...data, modules: { ...data.modules, [key]: !data.modules[key] } });
  }

  function toggleEmailAccount(id: string) {
    if (!data) return;
    setData({
      ...data,
      emailAccounts: data.emailAccounts.map((a) => (a.id === id ? { ...a, granted: !a.granted } : a)),
    });
  }

  function setEmailCanReply(id: string, canReply: boolean) {
    if (!data) return;
    setData({ ...data, emailAccounts: data.emailAccounts.map((a) => (a.id === id ? { ...a, canReply } : a)) });
  }

  function toggleSocialAccount(id: string) {
    if (!data) return;
    setData({
      ...data,
      socialAccounts: data.socialAccounts.map((a) => (a.id === id ? { ...a, granted: !a.granted } : a)),
    });
  }

  function setSocialFlag(id: string, flag: "canPublish" | "canApprove", value: boolean) {
    if (!data) return;
    setData({
      ...data,
      socialAccounts: data.socialAccounts.map((a) => (a.id === id ? { ...a, [flag]: value } : a)),
    });
  }

  async function save() {
    if (!data) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.updateUserAccess(userId, {
        modules: data.isAdmin ? undefined : data.modules,
        emailAccounts: data.emailAccounts.map((a) => ({ accountId: a.id, granted: a.granted, canReply: a.canReply })),
        socialAccounts: data.socialAccounts.map((a) => ({
          accountId: a.id,
          granted: a.granted,
          canPublish: a.canPublish,
          canApprove: a.canApprove,
        })),
      });
      setNotice("Saved.");
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!data) {
    return error ? <p className="text-xs text-bad">{error}</p> : <p className="text-xs text-ink/50">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-[var(--line)] bg-ink/[0.02] p-4">
      {error && <div className="rounded border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-2 py-1.5 text-xs text-bad">{error}</div>}
      {notice && <div className="rounded border border-[rgb(var(--good-rgb)/0.4)] bg-[rgb(var(--good-rgb)/0.06)] px-2 py-1.5 text-xs text-good">{notice}</div>}

      <div>
        <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/55">Modules</h4>
        {data.isAdmin ? (
          <p className="text-xs text-ink/50">Admins always have access to every module — this can&apos;t be restricted here.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {MODULE_LABELS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={data.modules[key]} onChange={() => toggleModule(key)} />
                {label}
              </label>
            ))}
          </div>
        )}
      </div>

      {data.emailAccounts.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/55">Email accounts</h4>
          <div className="flex flex-col gap-1.5">
            {data.emailAccounts.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={a.granted} onChange={() => toggleEmailAccount(a.id)} />
                  {a.mailboxLabel || a.address}
                </label>
                {a.granted && (
                  <label className="flex items-center gap-1.5 text-xs text-ink/60">
                    <input type="checkbox" checked={a.canReply} onChange={(e) => setEmailCanReply(a.id, e.target.checked)} />
                    can reply
                  </label>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.socialAccounts.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/55">Social accounts</h4>
          <div className="flex flex-col gap-1.5">
            {data.socialAccounts.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={a.granted} onChange={() => toggleSocialAccount(a.id)} />
                  {a.platform} — {a.displayName || a.username}
                </label>
                {a.granted && (
                  <>
                    <label className="flex items-center gap-1.5 text-xs text-ink/60">
                      <input type="checkbox" checked={a.canPublish} onChange={(e) => setSocialFlag(a.id, "canPublish", e.target.checked)} />
                      can publish
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-ink/60">
                      <input type="checkbox" checked={a.canApprove} onChange={(e) => setSocialFlag(a.id, "canApprove", e.target.checked)} />
                      can approve
                    </label>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        disabled={saving}
        onClick={save}
        className="self-start rounded-md bg-accent px-4 py-2 text-xs text-white disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save access"}
      </button>
    </div>
  );
}
