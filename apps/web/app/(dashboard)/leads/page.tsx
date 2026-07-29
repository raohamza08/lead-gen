"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api-client";
import { PipelineStage } from "@leadgen/types";
import type { Lead, LeadScore } from "@leadgen/types";

interface LeadRow extends Lead {
  score: LeadScore | null;
  pipelineState: { stage: string } | null;
}

const EMPTY_LEAD = {
  companyName: "",
  website: "",
  linkedinUrl: "",
  contactName: "",
  jobTitle: "",
  email: "",
  phone: "",
  industry: "",
  country: "",
  city: "",
  businessDescription: "",
  notes: "",
};

function scoreTone(score?: number | null) {
  if (score == null) return "text-ink/40";
  if (score >= 75) return "text-good";
  if (score >= 50) return "text-gold";
  return "text-ink/55";
}

function StagePill({ stage }: { stage?: string | null }) {
  if (!stage) return <span className="text-ink/40">—</span>;
  const won = stage === PipelineStage.WON || stage === PipelineStage.CLIENT_ONBOARDING;
  const lost = stage === PipelineStage.LOST;
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ${
        won ? "bg-[rgb(var(--good-rgb)/0.12)] text-good"
          : lost ? "bg-[rgb(var(--bad-rgb)/0.1)] text-bad"
          : "bg-ink/8 text-ink/70"
      }`}
    >
      {stage.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}
    </span>
  );
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Filters. The backend already supports these query params; this exposes them.
  const [search, setSearch] = useState("");
  const [industry, setIndustry] = useState("");
  const [country, setCountry] = useState("");
  const [stage, setStage] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState(EMPTY_LEAD);
  const [saving, setSaving] = useState(false);

  function load() {
    api
      .getLeads({ pageSize: "200" })
      .then((res: any) => setLeads(res.items ?? res))
      .catch((err) => setError((err as Error).message));
  }

  useEffect(load, []);

  // Filtered in the browser because the whole page is already loaded; going
  // back to the server for each keystroke would be slower and no more correct
  // at this size. Swap to server-side filtering past a few thousand leads.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (q && ![l.companyName, l.contactName, l.email, l.website].some((v) => v?.toLowerCase().includes(q))) return false;
      if (industry && l.industry !== industry) return false;
      if (country && l.country !== country) return false;
      if (stage && (l.pipelineState?.stage ?? "") !== stage) return false;
      return true;
    });
  }, [leads, search, industry, country, stage]);

  const industries = useMemo(
    () => [...new Set(leads.map((l) => l.industry).filter(Boolean))].sort() as string[],
    [leads],
  );
  const countries = useMemo(
    () => [...new Set(leads.map((l) => l.country).filter(Boolean))].sort() as string[],
    [leads],
  );

  async function addLead(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      // Blank fields are stripped so an untouched box stores nothing rather
      // than an empty string that later reads as "we checked and it's empty".
      const payload = Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== ""));
      await api.createManualLead(payload);
      setDraft(EMPTY_LEAD);
      setShowForm(false);
      setNotice(`Added ${draft.companyName}. It starts unverified — run enrichment to score it.`);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Leads</h1>
          <p className="mt-0.5 text-xs text-ink/55">
            {filtered.length === leads.length
              ? `${leads.length} leads`
              : `${filtered.length} of ${leads.length} leads`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90"
        >
          {showForm ? "Cancel" : "+ Add lead"}
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

      {showForm && (
        <form onSubmit={addLead} className="card p-5">
          <h2 className="mb-1 text-sm font-semibold tracking-tight">Add a lead manually</h2>
          <p className="mb-4 text-xs text-ink/50">
            Only the company name is required. The lead starts <strong>unverified and unscored</strong> —
            nothing has checked the website or email yet, and marking it otherwise would put unchecked
            addresses into the send queue.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {([
              ["companyName", "Company name *", "Acme Health"],
              ["website", "Website", "https://acme.com"],
              ["linkedinUrl", "Company LinkedIn", "linkedin.com/company/acme"],
              ["contactName", "Contact name", "Jordan Blake"],
              ["jobTitle", "Job title", "Operations Director"],
              ["email", "Email", "jordan@acme.com"],
              ["phone", "Phone", "+1 555 0100"],
              ["industry", "Industry", "Healthcare"],
              ["country", "Country", "United States"],
              ["city", "City", "Austin"],
            ] as const).map(([key, label, placeholder]) => (
              <label key={key} className="block">
                <span className="mb-1 block text-xs text-ink/60">{label}</span>
                <input
                  value={draft[key]}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                  required={label.endsWith("*")}
                  type={key === "email" ? "email" : "text"}
                  placeholder={placeholder}
                  className="w-full rounded-lg border border-[var(--line)] bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-[rgb(var(--accent-rgb)/0.6)]"
                />
              </label>
            ))}
          </div>
          <label className="mt-3 block">
            <span className="mb-1 block text-xs text-ink/60">Why are you adding this lead?</span>
            <textarea
              value={draft.notes}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              rows={2}
              placeholder="Met at a conference; asked us to follow up in Q3."
              className="w-full rounded-lg border border-[var(--line)] bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-[rgb(var(--accent-rgb)/0.6)]"
            />
          </label>
          <button
            type="submit"
            disabled={saving || !draft.companyName.trim()}
            className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Adding…" : "Add lead"}
          </button>
        </form>
      )}

      <div className="card flex flex-wrap items-end gap-3 p-3">
        <label className="min-w-[200px] flex-1">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink/55">Search</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Company, contact, email or site"
            className="w-full rounded-lg border border-[var(--line)] bg-transparent px-3 py-1.5 text-sm outline-none focus:border-[rgb(var(--accent-rgb)/0.6)]"
          />
        </label>
        {([
          ["Industry", industry, setIndustry, industries],
          ["Country", country, setCountry, countries],
        ] as const).map(([label, value, setter, options]) => (
          <label key={label}>
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink/55">{label}</span>
            <select
              value={value}
              onChange={(e) => setter(e.target.value)}
              className="rounded-lg border border-[var(--line)] bg-transparent px-3 py-1.5 text-sm outline-none"
            >
              <option value="">All</option>
              {options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        ))}
        <label>
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink/55">Stage</span>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="rounded-lg border border-[var(--line)] bg-transparent px-3 py-1.5 text-sm outline-none"
          >
            <option value="">All</option>
            {Object.values(PipelineStage).map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>
            ))}
          </select>
        </label>
        {(search || industry || country || stage) && (
          <button
            type="button"
            onClick={() => { setSearch(""); setIndustry(""); setCountry(""); setStage(""); }}
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-ink/70 hover:bg-ink/5"
          >
            Clear
          </button>
        )}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b border-[var(--line)] text-left text-[11px] uppercase tracking-wide text-ink/55">
            <tr>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Industry</th>
              <th className="px-4 py-3">Country</th>
              <th className="px-4 py-3">Decision maker</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3 text-right">Score</th>
              <th className="px-4 py-3 text-right">AI opp.</th>
              <th className="px-4 py-3">Stage</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((lead) => (
              <tr key={lead.id} className="border-b border-[var(--line)] transition-colors last:border-0 hover:bg-ink/5">
                <td className="px-4 py-3">
                  <Link href={`/leads/${lead.id}`} className="font-medium text-accent hover:underline">
                    {lead.companyName}
                  </Link>
                  {lead.website && (
                    <div className="mt-0.5 truncate text-[11px] text-ink/45">
                      {lead.website.replace(/^https?:\/\//, "")}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-ink/70">{lead.industry ?? "—"}</td>
                <td className="px-4 py-3 text-ink/70">{lead.country ?? "—"}</td>
                <td className="px-4 py-3">
                  {lead.contactName ? (
                    <>
                      <div className="text-ink/80">{lead.contactName}</div>
                      {lead.jobTitle && <div className="text-[11px] text-ink/45">{lead.jobTitle}</div>}
                    </>
                  ) : <span className="text-ink/40">—</span>}
                </td>
                <td className="px-4 py-3 text-ink/60">{lead.email ?? <span className="text-ink/40">—</span>}</td>
                <td className={`tabular px-4 py-3 text-right font-semibold ${scoreTone(lead.score?.leadScore)}`}>
                  {lead.score?.leadScore ?? "—"}
                </td>
                <td className={`tabular px-4 py-3 text-right ${scoreTone(lead.score?.aiOpportunityScore)}`}>
                  {lead.score?.aiOpportunityScore ?? "—"}
                </td>
                <td className="px-4 py-3"><StagePill stage={lead.pipelineState?.stage} /></td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-ink/50">
                  {leads.length === 0
                    ? "No leads yet — configure a niche filter in Settings, or add one manually above."
                    : "No leads match these filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
