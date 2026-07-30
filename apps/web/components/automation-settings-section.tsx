"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api-client";

/**
 * The one dial that turns "AI drafts a pitch" into "AI drafts AND sends a
 * pitch" — everything else in the outreach sequence (Email 1/2, follow-up
 * scheduling, LinkedIn drafting) already runs with no approval step. This is
 * the sole point where an org can put a human back in front of an
 * AI-drafted email before it reaches a real prospect.
 */
export function AutomationSettingsSection() {
  const [autoSendEnabled, setAutoSendEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api
      .getAutomationSettings()
      .then((res: any) => setAutoSendEnabled(Boolean(res.autoSendEnabled)))
      .catch((err) => setError((err as Error).message));
  }, []);

  async function toggle() {
    if (autoSendEnabled === null) return;
    const next = !autoSendEnabled;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated: any = await api.updateAutomationSettings({ autoSendEnabled: next });
      setAutoSendEnabled(Boolean(updated.autoSendEnabled));
      setNotice(
        updated.autoSendEnabled
          ? "The AI-drafted pitch now sends itself once drafted."
          : "The AI-drafted pitch now waits for approval on the lead's page before sending.",
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (autoSendEnabled === null) return null;

  return (
    <section className="rounded-xl border border-[var(--line)] p-5">
      <h2 className="mb-1 text-sm font-semibold tracking-tight">Automation</h2>
      <p className="mb-4 text-xs text-ink/50">
        Every other step of outreach already runs on its own — this is the one place a human can
        still be required to approve an AI-drafted email before it sends.
      </p>

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

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={autoSendEnabled}
          disabled={saving}
          onChange={toggle}
        />
        <span>
          <span className="block text-sm font-medium text-ink">Auto-send the AI-drafted pitch</span>
          <span className="block text-xs text-ink/50">
            On: Email #3 sends itself as soon as it&apos;s drafted. Off: it waits at
            &ldquo;Pending approval&rdquo; on the lead&apos;s page for a human to approve, edit, or reject
            it first.
          </span>
        </span>
      </label>
    </section>
  );
}
