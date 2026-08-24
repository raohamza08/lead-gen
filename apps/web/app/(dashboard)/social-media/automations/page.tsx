"use client";

import { useEffect, useState } from "react";
import { api } from "../../../../lib/api-client";
import { SectionCard } from "../../../../components/chart-kit";

interface Account {
  id: string;
  platform: string;
  username: string;
  displayName: string | null;
}

interface Automation {
  id: string;
  name: string;
  triggerType: string;
  actions: Array<Record<string, unknown>>;
  active: boolean;
  createdAt: string;
}

interface AutomationRun {
  id: string;
  triggerRef: string | null;
  status: string;
  resultNote: string | null;
  createdAt: string;
}

/**
 * WHEN this happens -> DO this (Part: Social Media Automations). V1 only
 * implements the NEW_LEAD trigger — the one trigger that maps to something
 * real in this codebase (see SocialAutomation's schema comment) — so the
 * trigger is fixed rather than offered as a dropdown with options that would
 * silently do nothing.
 */
export default function AutomationsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [name, setName] = useState("");
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [brief, setBrief] = useState("");
  const [notifyOnly, setNotifyOnly] = useState(false);
  const [expandedRuns, setExpandedRuns] = useState<Record<string, AutomationRun[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function refresh() {
    api.getSocialAutomations().then((r) => setAutomations(r as Automation[])).catch((err) => setError((err as Error).message));
  }

  useEffect(() => {
    refresh();
    api.getSocialAccounts().then((r) => setAccounts(r as Account[])).catch((err) => setError((err as Error).message));
  }, []);

  function toggleAccount(id: string) {
    setAccountIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!notifyOnly && accountIds.length === 0) {
      setError("Select at least one account for the draft, or switch to a notify-only automation.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const actions = notifyOnly
        ? [{ type: "NOTIFY", message: `New lead — consider a ${name} post.` }]
        : [{ type: "CREATE_DRAFT", accountIds, brief: brief || undefined }];
      await api.createSocialAutomation({ name, triggerType: "NEW_LEAD", actions });
      setName("");
      setAccountIds([]);
      setBrief("");
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(automation: Automation) {
    try {
      await api.updateSocialAutomation(automation.id, { active: !automation.active });
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this automation?")) return;
    try {
      await api.deleteSocialAutomation(id);
      setAutomations((a) => a.filter((x) => x.id !== id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function toggleRuns(id: string) {
    if (expandedRuns[id]) {
      setExpandedRuns((r) => {
        const { [id]: _drop, ...rest } = r;
        return rest;
      });
      return;
    }
    try {
      const runs = (await api.getSocialAutomationRuns(id)) as AutomationRun[];
      setExpandedRuns((r) => ({ ...r, [id]: runs }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function describeActions(actions: Automation["actions"]): string {
    return actions
      .map((a) => (a.type === "CREATE_DRAFT" ? `Draft on ${((a.accountIds as string[]) ?? []).length} account(s)` : `Notify: ${a.message ?? ""}`))
      .join("; ");
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Automations</h1>
        <p className="mt-0.5 text-xs text-ink/50">
          Automatically draft a post (or notify someone) whenever a new lead is created.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
          {error}
        </div>
      )}

      <SectionCard title="New automation" subtitle="Trigger: New lead created (the only trigger currently wired up).">
        <form onSubmit={create} className="flex flex-col gap-3">
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this automation"
            className="rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={notifyOnly} onChange={(e) => setNotifyOnly(e.target.checked)} />
            Just notify me — don't draft a post
          </label>
          {!notifyOnly && (
            <>
              <div className="flex flex-wrap gap-2">
                {accounts.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggleAccount(a.id)}
                    className={`rounded-full border px-3 py-1 text-xs ${accountIds.includes(a.id) ? "border-accent bg-accent text-white" : "border-[var(--line)] text-ink/70 hover:bg-ink/5"}`}
                  >
                    {a.platform} — {a.displayName || a.username}
                  </button>
                ))}
              </div>
              <input
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="AI brief (optional — defaults to a generic new-client announcement)"
                className="rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
              />
            </>
          )}
          <button type="submit" disabled={saving || !name.trim()} className="self-start rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-50">
            {saving ? "Creating…" : "Create automation"}
          </button>
        </form>
      </SectionCard>

      <div className="flex flex-col gap-3">
        {automations.map((a) => (
          <div key={a.id} className="card p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">{a.name}</div>
                <div className="mt-0.5 text-xs text-ink/55">
                  When: {a.triggerType.replace("_", " ")} → {describeActions(a.actions)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleActive(a)}
                  className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${a.active ? "bg-good/15 text-good" : "bg-ink/8 text-ink/50"}`}
                >
                  {a.active ? "Active" : "Paused"}
                </button>
                <button onClick={() => toggleRuns(a.id)} className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 hover:bg-ink/5">
                  {expandedRuns[a.id] ? "Hide runs" : "View runs"}
                </button>
                <button onClick={() => remove(a.id)} className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-bad hover:bg-bad/5">
                  Delete
                </button>
              </div>
            </div>
            {expandedRuns[a.id] && (
              <div className="mt-3 flex flex-col gap-1 border-t border-[var(--line)] pt-3">
                {expandedRuns[a.id].map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-xs">
                    <span className={r.status === "OK" ? "text-good" : "text-bad"}>{r.status}</span>
                    <span className="text-ink/60">{r.resultNote}</span>
                    <span className="text-ink/40">{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                ))}
                {expandedRuns[a.id].length === 0 && <p className="text-xs text-ink/50">No runs yet.</p>}
              </div>
            )}
          </div>
        ))}
        {automations.length === 0 && <p className="py-8 text-center text-sm text-ink/50">No automations yet.</p>}
      </div>
    </div>
  );
}
