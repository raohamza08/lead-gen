"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../../lib/api-client";
import { useRealtimeEvent } from "../../../../lib/realtime";
import { RangeInput, TagInput, TaxonomyMultiSelect } from "../../../../components/filter-controls";
import { SendingMailboxesSection } from "../../../../components/sending-mailboxes-section";
import { AutomationSettingsSection } from "../../../../components/automation-settings-section";
import { AgentPromptsSection } from "../../../../components/agent-prompts-section";
import { CaseStudiesSection } from "../../../../components/case-studies-section";
import type { NicheFilter } from "@leadgen/types";

/**
 * The lead-targeting filter builder.
 *
 * Only the niche is required — every other dimension left empty means "no
 * constraint", not "match nothing". That default matters: a user who fills in
 * just a niche gets broad results rather than none, and can then narrow.
 */

/** Mutable filter state. Mirrors UpsertNicheFilterDto. */
const EMPTY = {
  niche: "",
  subNiche: "",
  countries: [] as string[],
  cities: [] as string[],
  employeeCountMin: null as number | null,
  employeeCountMax: null as number | null,
  revenueBandMin: "",
  revenueBandMax: "",
  yearsInBusinessMin: null as number | null,
  yearsInBusinessMax: null as number | null,
  jobTitles: [] as string[],
  technologies: [] as string[],
  businessModel: "",
  b2bOrB2c: "",
  fundingStage: "",
  companyTypes: [] as string[],
  growthStages: [] as string[],
  companyKeywords: [] as string[],
  departments: [] as string[],
  seniorityLevels: [] as string[],
  hiringSignals: [] as string[],
  websiteConditions: [] as string[],
  aiOpportunitySignals: [] as string[],
  exclusionSignals: [] as string[],
  excludeIndustries: [] as string[],
  excludeKeywords: [] as string[],
  excludeCompanies: [] as string[],
  dailyTarget: 100,
  disabledAgents: [] as string[],
  scheduleCron: "0 6 * * *",
  timezone: "UTC",
};

type FilterDraft = typeof EMPTY;

/** The only three agents a filter can drop — see disabledAgents on NicheFilter. */
const ENRICHMENT_AGENTS: { key: string; label: string; hint: string }[] = [
  { key: "company_intelligence", label: "Company intelligence", hint: "SWOT, competitors, recent news" },
  { key: "website_audit", label: "Website audit", hint: "UX/SEO issues quoted back to the prospect" },
  { key: "buyer_intelligence", label: "Buyer intelligence", hint: "Persona of the decision maker" },
];

interface RunProgress {
  runId: string;
  status: "RUNNING" | "COMPLETED" | "COMPLETED_SHORT_OF_TARGET" | "FAILED" | "CANCELLED";
  leadsFound: number;
  leadsVerified: number;
  duplicatesSkipped: number;
  error?: string | null;
}

/** Live "Run now" progress, one row's worth. `leadsFound` is actually attempts
 *  made (existing ExtractionRun naming, not renamed here), so rejected is
 *  derived rather than tracked as its own column. */
function RunProgressLine({ p, target }: { p: RunProgress; target: number }) {
  const rejected = Math.max(0, p.leadsFound - p.leadsVerified - p.duplicatesSkipped);
  if (p.status === "RUNNING") {
    return (
      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-accent">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        Running — {p.leadsVerified}/{target} verified · {rejected} rejected
        {p.duplicatesSkipped > 0 && <> · {p.duplicatesSkipped} dup</>}
      </div>
    );
  }
  if (p.status === "FAILED") {
    return (
      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-bad" title={p.error ?? undefined}>
        <span className="h-1.5 w-1.5 rounded-full bg-bad" />
        Failed{p.error ? `: ${p.error}` : ""}
      </div>
    );
  }
  if (p.status === "CANCELLED") {
    return (
      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink/50">
        <span className="h-1.5 w-1.5 rounded-full bg-ink/40" />
        Stopped — {p.leadsVerified}/{target} verified · {rejected} rejected
        {p.duplicatesSkipped > 0 && <> · {p.duplicatesSkipped} dup</>}
      </div>
    );
  }
  const tone = p.status === "COMPLETED" ? "text-good" : "text-gold";
  return (
    <div className={`mt-1 flex items-center gap-1.5 text-[11px] ${tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${p.status === "COMPLETED" ? "bg-good" : "bg-gold"}`} />
      Done — {p.leadsVerified}/{target} verified · {rejected} rejected
      {p.duplicatesSkipped > 0 && <> · {p.duplicatesSkipped} dup</>}
    </div>
  );
}

export default function LeadGenerationSettingsPage() {
  const [filters, setFilters] = useState<NicheFilter[]>([]);
  const [draft, setDraft] = useState<FilterDraft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [togglingCost, setTogglingCost] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [runningNow, setRunningNow] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [runProgress, setRunProgress] = useState<Record<string, RunProgress>>({});

  function refresh() {
    api
      .getNicheFilters()
      .then((res) => setFilters(res as NicheFilter[]))
      .catch((err) => setError((err as Error).message));
  }

  useEffect(refresh, []);

  // Live progress for whichever filter(s) currently have a "Run now" extraction
  // in flight — pushed once per candidate attempt by the worker, not just once
  // at the very end, so this updates continuously while a run is going.
  useRealtimeEvent<RunProgress & { filterId: string }>("extractionRun.progress", (payload) => {
    setRunProgress((cur) => ({ ...cur, [payload.filterId]: payload }));
  });

  async function runNow(filter: NicheFilter) {
    setRunningNow(filter.id);
    setError(null);
    try {
      const run = (await api.runNicheFilterNow(filter.id)) as { id: string; status: string };
      // Optimistic seed so the row shows "Running…" immediately rather than
      // waiting for the worker's first progress ping, which can be many
      // seconds away (dispatch queue + first candidate's web search).
      setRunProgress((cur) => ({
        ...cur,
        [filter.id]: {
          runId: run.id,
          status: "RUNNING",
          leadsFound: 0,
          leadsVerified: 0,
          duplicatesSkipped: 0,
        },
      }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunningNow(null);
    }
  }

  /** Stops a run in flight. The worker finishes whatever candidate it's
   *  already mid-search on rather than cutting it off instantly — see the
   *  comment on the API's cancelRun for why. Optimistically flips the row to
   *  CANCELLED now rather than waiting for that to land, same reasoning as
   *  runNow's optimistic seed above. */
  async function cancelRun(filter: NicheFilter) {
    const runId = runProgress[filter.id]?.runId;
    if (!runId) return;
    setCancellingId(filter.id);
    setError(null);
    try {
      await api.cancelNicheFilterRun(filter.id, runId);
      setRunProgress((cur) => {
        const current = cur[filter.id];
        return current ? { ...cur, [filter.id]: { ...current, status: "CANCELLED" } } : cur;
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCancellingId(null);
    }
  }

  const set = <K extends keyof FilterDraft>(key: K, value: FilterDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  /**
   * Flips between the full 6-call pipeline and the reduced 3-call one by
   * PATCHing all three enrichment agents on or off together — a per-agent
   * toggle in this table would need three buttons per row for a saving most
   * users take all-or-nothing; the create form still offers per-agent control.
   * The whole filter is re-sent because UpsertNicheFilterDto requires `niche`,
   * and the update endpoint replaces (rather than merges) what's provided.
   */
  async function toggleCost(filter: NicheFilter) {
    setTogglingCost(filter.id);
    setError(null);
    try {
      const nextDisabled =
        filter.disabledAgents.length > 0
          ? []
          : ["company_intelligence", "website_audit", "buyer_intelligence"];
      await api.updateNicheFilter(filter.id, { ...filter, disabledAgents: nextDisabled });
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTogglingCost(null);
    }
  }

  /**
   * Deleting is destructive and irreversible, so the confirmation states the
   * real consequences with real numbers fetched first — a generic "are you
   * sure?" gives the user nothing to base the decision on.
   */
  async function confirmDelete(filter: NicheFilter) {
    setError(null);
    try {
      const impact = (await api.getFilterDeletionImpact(filter.id)) as {
        leadsKept: number;
        runsDeleted: number;
      };

      const message =
        `Delete the "${filter.niche}" filter?\n\n` +
        `• ${impact.leadsKept} lead(s) will be KEPT and detached from this filter.\n` +
        `• ${impact.runsDeleted} extraction run(s) will be permanently deleted.\n` +
        `• Its schedule stops immediately.\n\n` +
        (impact.runsDeleted > 0
          ? "Deleting the run history will change the duplicate-rate figure on the Overview page.\n\n"
          : "") +
        "This cannot be undone.";

      if (!window.confirm(message)) return;

      const result = (await api.deleteNicheFilter(filter.id)) as { leadsKept: number };
      setNotice(`Deleted "${filter.niche}". ${result.leadsKept} lead(s) kept.`);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function saveFilter(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // Empty strings are stripped rather than sent: the API treats "" as a
      // provided-but-blank value, which would store an empty criterion.
      const payload = Object.fromEntries(
        Object.entries(draft).filter(([, v]) => {
          if (v === "" || v === null) return false;
          if (Array.isArray(v) && v.length === 0) return false;
          return true;
        }),
      );
      if (editingId) {
        await api.updateNicheFilter(editingId, payload);
      } else {
        await api.createNicheFilter(payload);
      }
      setDraft(EMPTY);
      setEditingId(null);
      setShowBuilder(false);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /** Loads a saved filter into the same builder used to create one — editing
   *  and viewing are the same form, since every field is already shown. */
  function startEdit(f: NicheFilter) {
    setEditingId(f.id);
    setDraft({
      niche: f.niche,
      subNiche: f.subNiche ?? "",
      countries: f.countries ?? [],
      cities: f.cities ?? [],
      employeeCountMin: f.employeeCountMin,
      employeeCountMax: f.employeeCountMax,
      revenueBandMin: f.revenueBandMin ?? "",
      revenueBandMax: f.revenueBandMax ?? "",
      yearsInBusinessMin: f.yearsInBusinessMin,
      yearsInBusinessMax: f.yearsInBusinessMax,
      jobTitles: f.jobTitles ?? [],
      technologies: f.technologies ?? [],
      businessModel: f.businessModel ?? "",
      b2bOrB2c: f.b2bOrB2c ?? "",
      fundingStage: f.fundingStage ?? "",
      companyTypes: f.companyTypes ?? [],
      growthStages: f.growthStages ?? [],
      companyKeywords: f.companyKeywords ?? [],
      departments: f.departments ?? [],
      seniorityLevels: f.seniorityLevels ?? [],
      hiringSignals: f.hiringSignals ?? [],
      websiteConditions: f.websiteConditions ?? [],
      aiOpportunitySignals: f.aiOpportunitySignals ?? [],
      exclusionSignals: f.exclusionSignals ?? [],
      excludeIndustries: f.excludeIndustries ?? [],
      excludeKeywords: f.excludeKeywords ?? [],
      excludeCompanies: f.excludeCompanies ?? [],
      dailyTarget: f.dailyTarget,
      disabledAgents: f.disabledAgents ?? [],
      scheduleCron: f.scheduleCron,
      timezone: f.timezone,
    });
    setShowBuilder(true);
  }

  /** How many dimensions this filter actually constrains — the quickest read on
   *  whether a saved filter is well-targeted or wide open. */
  function criteriaCount(f: NicheFilter): number {
    const arrays = [
      f.countries, f.cities, f.jobTitles, f.technologies, f.companyTypes, f.growthStages,
      f.companyKeywords, f.departments, f.seniorityLevels, f.hiringSignals,
      f.websiteConditions, f.aiOpportunitySignals, f.exclusionSignals,
      f.excludeIndustries, f.excludeKeywords, f.excludeCompanies,
    ];
    const scalars = [
      f.subNiche, f.employeeCountMin, f.employeeCountMax, f.revenueBandMin, f.revenueBandMax,
      f.yearsInBusinessMin, f.yearsInBusinessMax, f.businessModel, f.b2bOrB2c, f.fundingStage,
    ];
    return (
      arrays.reduce((n, a) => n + (a?.length ? 1 : 0), 0) +
      scalars.reduce((n: number, s) => n + (s != null && s !== "" ? 1 : 0), 0)
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/settings" className="text-xs text-accent hover:underline">
          ← General settings
        </Link>
        <h1 className="mt-1 text-lg font-semibold tracking-tight">Lead Generation Settings</h1>
        <p className="mt-0.5 text-xs text-ink/50">
          Targeting, outreach sending, case studies, and agent behavior for the lead-gen pipeline.
        </p>
      </div>

      <AutomationSettingsSection />
      <SendingMailboxesSection />
      <CaseStudiesSection />
      <AgentPromptsSection />

      <section className="rounded-xl border border-[var(--line)] p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">Niche filters</h2>
          <button
            type="button"
            onClick={() => {
              if (showBuilder) {
                setDraft(EMPTY);
                setEditingId(null);
              }
              setShowBuilder((v) => !v);
            }}
            className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5"
          >
            {showBuilder ? "Cancel" : "New filter"}
          </button>
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
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink/55">
              <tr className="border-b border-[var(--line)]">
                <th className="py-2 pr-3">Niche</th>
                <th className="py-2 pr-3">Criteria</th>
                <th className="tabular py-2 pr-3">Daily target</th>
                <th className="py-2 pr-3">Schedule</th>
                <th className="py-2 pr-3">Active</th>
                <th className="py-2 pr-3">Cost / candidate</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {filters.map((f) => (
                <tr key={f.id} className="border-b border-[var(--line)] last:border-0">
                  <td className="py-2 pr-3">
                    {f.niche}
                    {f.subNiche ? <span className="text-ink/50"> — {f.subNiche}</span> : null}
                  </td>
                  <td className="py-2 pr-3">
                    {criteriaCount(f) === 0 ? (
                      <span className="text-gold" title="Only the niche is set, so results will be broad and generic.">
                        niche only
                      </span>
                    ) : (
                      <span className="text-ink/60">{criteriaCount(f)} set</span>
                    )}
                  </td>
                  <td className="tabular py-2 pr-3">{f.dailyTarget}</td>
                  <td className="py-2 pr-3 text-ink/60">
                    {f.scheduleCron} ({f.timezone})
                  </td>
                  <td className="py-2 pr-3">{f.active ? "Yes" : "No"}</td>
                  <td className="py-2 pr-3">
                    <button
                      disabled={togglingCost === f.id}
                      onClick={() => toggleCost(f)}
                      title="The three enrichment agents (company intelligence, website audit, buyer intelligence) can be skipped; discovery, verification, opportunity and scoring always run."
                      className={`rounded px-2 py-0.5 text-xs transition-colors disabled:opacity-50 ${
                        f.disabledAgents.length > 0
                          ? "bg-good/20 text-good hover:bg-good/30"
                          : "bg-gold/20 text-gold hover:bg-gold/30"
                      }`}
                    >
                      {f.disabledAgents.length > 0
                        ? `Reduced (${3} calls)`
                        : `Full (${6} calls)`}
                    </button>
                  </td>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => runNow(f)}
                        disabled={runningNow === f.id || runProgress[f.id]?.status === "RUNNING"}
                        className="rounded-md bg-accent px-2.5 py-1 text-xs text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        {runningNow === f.id
                          ? "Starting…"
                          : runProgress[f.id]?.status === "RUNNING"
                            ? "Running…"
                            : "Run now"}
                      </button>
                      {runProgress[f.id]?.status === "RUNNING" && (
                        <button
                          onClick={() => cancelRun(f)}
                          disabled={cancellingId === f.id}
                          className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-bad transition-colors hover:bg-[rgb(var(--bad-rgb)/0.08)] disabled:opacity-50"
                        >
                          {cancellingId === f.id ? "Stopping…" : "Stop"}
                        </button>
                      )}
                      <button
                        onClick={() => startEdit(f)}
                        className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => confirmDelete(f)}
                        className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-bad transition-colors hover:bg-[rgb(var(--bad-rgb)/0.08)]"
                      >
                        Delete
                      </button>
                    </div>
                    {runProgress[f.id] && <RunProgressLine p={runProgress[f.id]} target={f.dailyTarget} />}
                  </td>
                </tr>
              ))}
              {filters.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-sm text-ink/50">
                    No filters yet. Create one to start finding leads.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {showBuilder && (
        <form onSubmit={saveFilter} className="flex flex-col gap-4">
          <section className="rounded-xl border border-[var(--line)] p-5">
            <h2 className="mb-1 text-sm font-semibold tracking-tight">
              {editingId ? `Edit filter — ${draft.niche || "untitled"}` : "Target profile"}
            </h2>
            <p className="mb-4 text-xs text-ink/50">
              Only the niche is required. Every other field left blank means &ldquo;no constraint&rdquo;, so
              start broad and narrow once you see what comes back.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs text-ink/60">Niche / industry *</span>
                <input
                  value={draft.niche}
                  onChange={(e) => set("niche", e.target.value)}
                  required
                  placeholder="e.g. Recruitment agencies, Dental clinics, B2B SaaS"
                  className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ink/60">Sub-niche</span>
                <input
                  value={draft.subNiche}
                  onChange={(e) => set("subNiche", e.target.value)}
                  placeholder="e.g. Tech recruitment, Orthodontics"
                  className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <TagInput
                label="Countries"
                placeholder="United States, United Kingdom…"
                values={draft.countries}
                onChange={(v) => set("countries", v)}
              />
              <TagInput
                label="Cities / regions"
                placeholder="London, Austin…"
                values={draft.cities}
                onChange={(v) => set("cities", v)}
              />
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <RangeInput
                label="Company headcount"
                unit="employees"
                min={draft.employeeCountMin}
                max={draft.employeeCountMax}
                onChange={(min, max) => setDraft((d) => ({ ...d, employeeCountMin: min, employeeCountMax: max }))}
              />
              <RangeInput
                label="Years in business"
                unit="years"
                min={draft.yearsInBusinessMin}
                max={draft.yearsInBusinessMax}
                onChange={(min, max) => setDraft((d) => ({ ...d, yearsInBusinessMin: min, yearsInBusinessMax: max }))}
              />
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs text-ink/60">Revenue from</span>
                <input
                  value={draft.revenueBandMin}
                  onChange={(e) => set("revenueBandMin", e.target.value)}
                  placeholder="$1M"
                  className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ink/60">Revenue to</span>
                <input
                  value={draft.revenueBandMax}
                  onChange={(e) => set("revenueBandMax", e.target.value)}
                  placeholder="$50M"
                  className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ink/60">Funding status</span>
                <input
                  value={draft.fundingStage}
                  onChange={(e) => set("fundingStage", e.target.value)}
                  placeholder="Bootstrapped, Series A…"
                  className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs text-ink/60">Business model</span>
                <input
                  value={draft.businessModel}
                  onChange={(e) => set("businessModel", e.target.value)}
                  placeholder="Subscription, Services, Marketplace…"
                  className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ink/60">Sells to</span>
                <input
                  value={draft.b2bOrB2c}
                  onChange={(e) => set("b2bOrB2c", e.target.value)}
                  placeholder="B2B, B2C, B2B2C"
                  className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <TagInput
                label="Company keywords"
                hint="Words that should appear in their positioning or site copy."
                placeholder="managed services, compliance…"
                values={draft.companyKeywords}
                onChange={(v) => set("companyKeywords", v)}
              />
              <TagInput
                label="Technologies used"
                placeholder="HubSpot, Shopify, WordPress…"
                values={draft.technologies}
                onChange={(v) => set("technologies", v)}
              />
            </div>

            <div className="mt-3 grid gap-3">
              <TaxonomyMultiSelect
                taxonomyKey="companyTypes"
                label="Company type"
                hint="Ownership structure predicts who can authorise spend, and how long it takes."
                selected={draft.companyTypes}
                onChange={(v) => set("companyTypes", v)}
              />
              <TaxonomyMultiSelect
                taxonomyKey="growthStages"
                label="Growth stage"
                hint="Whether the operational pain exists yet, and whether an incumbent already owns the account."
                selected={draft.growthStages}
                onChange={(v) => set("growthStages", v)}
              />
            </div>
          </section>

          <section className="rounded-xl border border-[var(--line)] p-5">
            <h2 className="mb-1 text-sm font-semibold tracking-tight">Decision maker</h2>
            <p className="mb-4 text-xs text-ink/50">Who to look for inside a matching company.</p>
            <div className="grid gap-3">
              <TagInput
                label="Job titles"
                placeholder="Founder, Head of Operations, COO…"
                values={draft.jobTitles}
                onChange={(v) => set("jobTitles", v)}
              />
              <TaxonomyMultiSelect
                taxonomyKey="departments"
                label="Department"
                selected={draft.departments}
                onChange={(v) => set("departments", v)}
              />
              <TaxonomyMultiSelect
                taxonomyKey="seniorityLevels"
                label="Seniority"
                selected={draft.seniorityLevels}
                onChange={(v) => set("seniorityLevels", v)}
              />
            </div>
          </section>

          <section className="rounded-xl border border-accent/40 p-5">
            <h2 className="mb-1 text-sm font-semibold tracking-tight">Buying-intent signals</h2>
            <p className="mb-4 text-xs text-ink/50">
              The highest-value section. Firmographics say who a company <em>is</em>; these say whether it
              will actually buy. The lead-finder weights these above everything above.
            </p>
            <div className="grid gap-3">
              <TaxonomyMultiSelect
                taxonomyKey="aiOpportunitySignals"
                label="AI opportunity indicators"
                selected={draft.aiOpportunitySignals}
                onChange={(v) => set("aiOpportunitySignals", v)}
              />
              <TaxonomyMultiSelect
                taxonomyKey="hiringSignals"
                label="Hiring activity"
                hint="Job postings are the most reliable public intent signal — the budget already exists as salary."
                selected={draft.hiringSignals}
                onChange={(v) => set("hiringSignals", v)}
              />
              <TaxonomyMultiSelect
                taxonomyKey="websiteConditions"
                label="Website / technology conditions"
                hint="Verified by actually fetching the site, so each one is provable in the first email."
                selected={draft.websiteConditions}
                onChange={(v) => set("websiteConditions", v)}
              />
            </div>
          </section>

          <section className="rounded-xl border border-[var(--line)] p-5">
            <h2 className="mb-1 text-sm font-semibold tracking-tight">Exclusions</h2>
            <p className="mb-4 text-xs text-ink/50">
              Applied after everything else as a hard reject. Exclusions raise lead quality faster than any
              inclusion filter, because they remove the categories that consume sales time and never close.
            </p>
            <div className="grid gap-3">
              <TaxonomyMultiSelect
                taxonomyKey="exclusionSignals"
                label="Exclude by signal"
                selected={draft.exclusionSignals}
                onChange={(v) => set("exclusionSignals", v)}
              />
              <div className="grid gap-3 sm:grid-cols-3">
                <TagInput
                  label="Exclude industries"
                  values={draft.excludeIndustries}
                  onChange={(v) => set("excludeIndustries", v)}
                />
                <TagInput
                  label="Exclude keywords"
                  values={draft.excludeKeywords}
                  onChange={(v) => set("excludeKeywords", v)}
                />
                <TagInput
                  label="Exclude companies"
                  hint="Existing customers, competitors."
                  values={draft.excludeCompanies}
                  onChange={(v) => set("excludeCompanies", v)}
                />
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--line)] p-5">
            <h2 className="mb-4 text-sm font-semibold tracking-tight">Schedule</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs text-ink/60">Daily target</span>
                <input
                  type="number"
                  min={1}
                  value={draft.dailyTarget}
                  onChange={(e) => set("dailyTarget", Number(e.target.value))}
                  className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ink/60">Schedule (cron)</span>
                <input
                  value={draft.scheduleCron}
                  onChange={(e) => set("scheduleCron", e.target.value)}
                  className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-ink/60">Timezone</span>
                <input
                  value={draft.timezone}
                  onChange={(e) => set("timezone", e.target.value)}
                  className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="mt-4 border-t border-[var(--line)] pt-4">
              <span className="mb-1 block text-xs text-ink/60">
                Enrichment agents to skip — each candidate is 6 Claude CLI calls with all three on, 3 with
                all three off. Discovery, verification, opportunity and scoring always run.
              </span>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {ENRICHMENT_AGENTS.map((agent) => (
                  <label key={agent.key} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={draft.disabledAgents.includes(agent.key)}
                      onChange={(e) =>
                        set(
                          "disabledAgents",
                          e.target.checked
                            ? [...draft.disabledAgents, agent.key]
                            : draft.disabledAgents.filter((k) => k !== agent.key),
                        )
                      }
                    />
                    <span>
                      {agent.label}
                      <span className="block text-xs text-ink/50">{agent.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </section>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving || !draft.niche.trim()}
              className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : editingId ? "Save changes" : "Create filter"}
            </button>
            <button
              type="button"
              onClick={() => { setDraft(EMPTY); setEditingId(null); setShowBuilder(false); }}
              className="rounded-md border border-[var(--line)] px-4 py-2 text-sm text-ink/70"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
