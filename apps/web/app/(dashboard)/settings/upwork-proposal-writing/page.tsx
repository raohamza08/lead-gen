"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

interface FreelancerProfile {
  id: string;
  name: string;
  niche: string;
  active: boolean;
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

function FreelancerProfilesSection() {
  const queryClient = useQueryClient();
  const profilesQuery = useQuery({
    queryKey: ["upwork-freelancer-profiles"],
    queryFn: () => api.getUpworkFreelancerProfiles() as Promise<FreelancerProfile[]>,
  });
  const [name, setName] = useState("");
  const [niche, setNiche] = useState("");
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["upwork-freelancer-profiles"] });
  }

  const createMutation = useMutation({
    mutationFn: () => api.createUpworkFreelancerProfile({ name, niche }),
    onSuccess: () => {
      setName("");
      setNiche("");
      refresh();
    },
    onError: (err) => setError((err as Error).message),
  });
  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.updateUpworkFreelancerProfile(id, { active }),
    onSuccess: refresh,
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteUpworkFreelancerProfile(id),
    onSuccess: refresh,
  });

  return (
    <SectionCard title="Freelancer profiles">
      <p className="mb-2 text-xs text-ink/55">
        Individual freelancer identities and their niches — the generator suggests which one best fits each job. Inactive profiles are kept but
        never suggested.
      </p>
      {error && <div className="mb-2 text-xs text-bad">{error}</div>}
      {profilesQuery.isLoading ? (
        <Spinner className="h-4 w-4" />
      ) : (
        <div className="flex flex-col gap-2">
          {profilesQuery.data?.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--line)] px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">{p.name}</div>
                <div className="truncate text-xs text-ink/50">{p.niche}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-ink/60">
                  <input
                    type="checkbox"
                    checked={p.active}
                    onChange={(e) => toggleMutation.mutate({ id: p.id, active: e.target.checked })}
                  />
                  Active
                </label>
                <button
                  type="button"
                  onClick={() => deleteMutation.mutate(p.id)}
                  className="rounded-md border border-[var(--line)] px-2 py-1 text-xs text-ink/50 hover:border-bad hover:text-bad"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          {profilesQuery.data?.length === 0 && <p className="text-sm text-ink/50">No freelancer profiles yet.</p>}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--line)] pt-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="w-40 rounded-md border border-[var(--line)] bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
        <input
          type="text"
          value={niche}
          onChange={(e) => setNiche(e.target.value)}
          placeholder="Niche (e.g. Shopify & e-commerce design)"
          className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => {
            setError(null);
            createMutation.mutate();
          }}
          disabled={createMutation.isPending || !name.trim() || !niche.trim()}
          className="rounded-md bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </SectionCard>
  );
}

/**
 * Admin-editable prompt parameters the cover-letter generator is built from
 * (Part: Upwork Proposal Writing / Bidding SOP). Anyone with the module
 * flag can view this page; saving is ADMIN-only, enforced server-side
 * (same as Upwork API's connect/disconnect) — this edits shared, org-wide
 * configuration, not a per-user preference.
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

          <FreelancerProfilesSection />
        </>
      )}
    </div>
  );
}
