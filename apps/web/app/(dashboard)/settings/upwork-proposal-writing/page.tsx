"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard } from "../../../../components/chart-kit";
import { Spinner } from "../../../../components/spinner";

interface Settings {
  agencyBackground: string;
  instructions: string;
  technicalWordLimit: number;
  nonTechnicalWordLimit: number;
  excludedCountries: string[];
}

function ExcludedCountries({ countries, onChange }: { countries: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState("");
  function add() {
    const value = draft.trim();
    if (!value || countries.some((c) => c.toLowerCase() === value.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...countries, value]);
    setDraft("");
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {countries.map((c) => (
          <span key={c} className="flex items-center gap-1 rounded-full bg-ink/8 px-2.5 py-1 text-xs text-ink/70">
            {c}
            <button type="button" onClick={() => onChange(countries.filter((x) => x !== c))} className="text-ink/40 hover:text-bad">
              ×
            </button>
          </span>
        ))}
        {countries.length === 0 && <span className="text-xs text-ink/40">None — every country is fair game.</span>}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          placeholder="Add a country…"
          className="w-48 rounded-md border border-[var(--line)] bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
        <button type="button" onClick={add} className="rounded-md border border-[var(--line)] px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5">
          Add
        </button>
      </div>
    </div>
  );
}

/**
 * Admin-editable prompt parameters the cover-letter generator is built from
 * (Part: Upwork Proposal Writing / Bidding SOP). ADMIN-only for both
 * viewing and saving (explicit correction — "the settings are visible to
 * every user... it shouldn't be"), enforced server-side; a non-admin who
 * somehow lands here just sees the 403 below, not the form. Freelancer
 * Profiles management lives on the Proposal Writing page instead — every
 * granted user needs that, not just admins.
 */
export default function UpworkProposalWritingSettingsPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["upwork-proposal-writing-settings"],
    queryFn: () => api.getUpworkProposalWritingSettings() as Promise<Settings>,
    retry: false,
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

  if (settingsQuery.isError) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Proposal Writing Settings</h1>
        <p className="text-sm text-ink/55">This section is restricted to admins.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Proposal Writing Settings</h1>
        <p className="mt-0.5 text-xs text-ink/50">
          Controls how the Proposal Writing generator writes cover letters and evaluates jobs against the Bidding SOP — editable any time.
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
              Who&apos;s writing this — services offered, strengths, differentiators. Every letter is written in the voice of an individual
              freelancer (never an agency); the generator weaves this in naturally and never invents anything beyond what&apos;s here.
            </p>
            <textarea
              value={form.agencyBackground}
              onChange={(e) => setForm({ ...form, agencyBackground: e.target.value })}
              rows={5}
              className="w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
              placeholder="e.g. I'm a Shopify + web design freelancer specializing in DTC fashion/beauty brands..."
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

          <SectionCard title="Proposal length (Bidding SOP)">
            <p className="mb-2 text-xs text-ink/55">
              The generator classifies each job as technical or non-technical/graphics and writes within the matching limit below. Soft targets,
              not hard cutoffs.
            </p>
            <div className="flex flex-wrap gap-6">
              <label className="flex flex-col gap-1 text-xs text-ink/60">
                Technical jobs
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={30}
                    max={1000}
                    value={form.technicalWordLimit}
                    onChange={(e) => setForm({ ...form, technicalWordLimit: Number(e.target.value) })}
                    className="w-24 rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                  <span className="text-sm text-ink/55">words max</span>
                </div>
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink/60">
                Non-technical / graphics jobs
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={30}
                    max={1000}
                    value={form.nonTechnicalWordLimit}
                    onChange={(e) => setForm({ ...form, nonTechnicalWordLimit: Number(e.target.value) })}
                    className="w-24 rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                  <span className="text-sm text-ink/55">words max</span>
                </div>
              </label>
            </div>
          </SectionCard>

          <SectionCard title="Excluded client countries">
            <p className="mb-2 text-xs text-ink/55">
              Clients based in these countries get a clear warning on the generated proposal — it still generates, the decision to bid stays
              yours.
            </p>
            <ExcludedCountries countries={form.excludedCountries} onChange={(next) => setForm({ ...form, excludedCountries: next })} />
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
