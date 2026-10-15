"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard } from "../../../../components/chart-kit";
import { Spinner } from "../../../../components/spinner";

interface Settings {
  agencyBackground: string;
  instructions: string;
  wordCountTarget: number;
}

/**
 * Admin-editable prompt parameters the cover-letter generator is built from
 * (Part: Upwork Proposal Writing, explicit user request — "written on some
 * specific parameter, which you will set in the settings, so that i can
 * update it anytime"). Anyone with the module flag can view this page;
 * saving is ADMIN-only, enforced server-side (same as Upwork API's
 * connect/disconnect) — this edits a shared, org-wide prompt, not a
 * per-user preference.
 */
export default function UpworkProposalWritingSettingsPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["upwork-proposal-writing-settings"],
    queryFn: () => api.getUpworkProposalWritingSettings() as Promise<Settings>,
  });

  const [form, setForm] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settingsQuery.data && !form) setForm(settingsQuery.data);
  }, [settingsQuery.data, form]);

  async function save() {
    if (!form) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.updateUpworkProposalWritingSettings(form);
      setNotice("Saved.");
      queryClient.invalidateQueries({ queryKey: ["upwork-proposal-writing-settings"] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Proposal Writing Settings</h1>
        <p className="mt-0.5 text-xs text-ink/50">
          Controls how the Proposal Writing generator writes cover letters — editable any time, applies to every generation after saving.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-[rgb(var(--good-rgb)/0.4)] bg-[rgb(var(--good-rgb)/0.06)] px-3 py-2 text-sm text-good">{notice}</div>
      )}

      {settingsQuery.isLoading || !form ? (
        <Spinner className="h-4 w-4" />
      ) : (
        <>
          <SectionCard title="Agency / freelancer background">
            <p className="mb-2 text-xs text-ink/55">
              Who&apos;s writing this — services offered, strengths, differentiators. The generator weaves this in naturally and never invents
              anything beyond what&apos;s here.
            </p>
            <textarea
              value={form.agencyBackground}
              onChange={(e) => setForm({ ...form, agencyBackground: e.target.value })}
              rows={5}
              className="w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
              placeholder="e.g. We're a 4-person Shopify + web design agency specializing in DTC fashion/beauty brands..."
            />
          </SectionCard>

          <SectionCard title="Writing instructions">
            <p className="mb-2 text-xs text-ink/55">Tone, structure, must-include rules, things to avoid — the main prompt the generator follows.</p>
            <textarea
              value={form.instructions}
              onChange={(e) => setForm({ ...form, instructions: e.target.value })}
              rows={10}
              className="w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </SectionCard>

          <SectionCard title="Target length">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={30}
                max={500}
                value={form.wordCountTarget}
                onChange={(e) => setForm({ ...form, wordCountTarget: Number(e.target.value) })}
                className="w-24 rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <span className="text-sm text-ink/55">words (soft target, not a hard cutoff)</span>
            </div>
          </SectionCard>

          <div>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
