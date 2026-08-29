"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, downloadLeadsCsv } from "../../../lib/api-client";
import { useRealtimeRefetch } from "../../../lib/realtime";
import { PipelineStage } from "@leadgen/types";
import type { Lead, LeadScore } from "@leadgen/types";
import { LoadingRow, Spinner } from "../../../components/spinner";

interface LeadRow extends Lead {
  score: LeadScore | null;
  pipelineState: { stage: string } | null;
}

/** Mirrors apps/api/src/leads/lead-import-mapping.ts's IMPORTABLE_FIELDS —
 *  kept in sync by hand, same as that file's own note about
 *  CreateManualLeadDto: it's a small, stable list. */
const IMPORTABLE_FIELDS: { key: string; label: string }[] = [
  { key: "companyName", label: "Company name" },
  { key: "website", label: "Website" },
  { key: "linkedinUrl", label: "Company LinkedIn" },
  { key: "contactName", label: "Contact name" },
  { key: "jobTitle", label: "Job title" },
  { key: "contactLinkedinUrl", label: "Contact LinkedIn" },
  { key: "email", label: "Email" },
  { key: "personalEmail", label: "Personal email" },
  { key: "phone", label: "Phone" },
  { key: "industry", label: "Industry" },
  { key: "country", label: "Country" },
  { key: "city", label: "City" },
  { key: "employeeCount", label: "Employee count" },
  { key: "businessDescription", label: "Business description" },
  { key: "notes", label: "Notes" },
];

/**
 * `File.text()` always decodes as UTF-8 — that's the Blob spec, not a bug we
 * can configure around. A CSV exported by Excel outside the US (very common
 * for names with accented characters — "Geschäftsführer" and similar) is
 * usually saved as Windows-1252, not UTF-8, and every non-ASCII character in
 * it silently becomes U+FFFD ("�") when read as UTF-8. Traced from a real
 * batch of imported leads: one had "Geschäftsführer" corrupted into
 * "Gesch�ftsf�hrer" this exact way.
 *
 * Detected properly, not guessed: strict UTF-8 decoding (`fatal: true`)
 * throws on a real Windows-1252 accented byte (e.g. 0xFC for "ü") because
 * it's not a legal UTF-8 sequence. If it throws, the file was never UTF-8 to
 * begin with, so Windows-1252 — the overwhelmingly common alternative for a
 * spreadsheet CSV export — is the correct fallback, not one guess among many.
 */
async function decodeCsvFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

/** Same pattern as the backend's EMAIL_LIKE in lead-import-mapping.ts — used
 *  only to flag a suspicious mapping on the confirm screen, not to validate
 *  anything (the backend is still the actual gate on import). */
const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ImportPreview {
  headers: string[];
  suggestedMapping: Record<string, string | null>;
  previewRows: Record<string, string>[];
  totalRows: number;
}

interface ImportResult {
  created: number;
  duplicates: number;
  failed: { row: number; reason: string }[];
}

const EMPTY_LEADS: LeadRow[] = [];

const EMPTY_LEAD = {
  companyName: "",
  website: "",
  linkedinUrl: "",
  contactName: "",
  jobTitle: "",
  email: "",
  personalEmail: "",
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

/** No "dark web" option exists — see LeadSourceLayer's doc comment in
 *  @leadgen/types for why. */
const SOURCE_LABELS: Record<string, string> = {
  SURFACE_WEB: "Surface web",
  LICENSED_DATABASE: "Licensed database",
  MANUAL: "Manual entry",
  EMAIL: "Email",
  SOCIAL_MEDIA: "Social media",
};

function SourceBadge({ source }: { source?: string | null }) {
  if (!source) return <span className="text-ink/40">—</span>;
  return (
    <span className="whitespace-nowrap rounded-full bg-ink/8 px-2 py-0.5 text-[11px] text-ink/60">
      {SOURCE_LABELS[source] ?? source}
    </span>
  );
}

function StagePill({ stage }: { stage?: string | null }) {
  // No PipelineState row at all means this lead hasn't been promoted out of
  // Lead Room yet (Part: Lead Room / Move to Pipeline) — distinct from any
  // real stage, so it gets its own badge rather than reading as "unknown".
  if (!stage) {
    return (
      <span className="whitespace-nowrap rounded-full bg-gold/15 px-2 py-0.5 text-[11px] text-gold">
        Lead Room
      </span>
    );
  }
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
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Filters. The backend already supports these query params; this exposes them.
  const [search, setSearch] = useState("");
  const [industry, setIndustry] = useState("");
  const [country, setCountry] = useState("");
  const [stage, setStage] = useState("");
  const [source, setSource] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState(EMPTY_LEAD);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Move to Pipeline (Part: Lead Room) — source + count are chosen
  // independently of the table's own Source filter above, since promoting
  // is a distinct action from browsing.
  const [promoteSource, setPromoteSource] = useState("");
  const [promoteLimit, setPromoteLimit] = useState("");
  const [promoting, setPromoting] = useState(false);

  // CSV import: file -> preview+mapping screen -> confirm -> result summary.
  const [importCsv, setImportCsv] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importMapping, setImportMapping] = useState<Record<string, string | null>>({});
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  async function handleImportFileSelected(file: File) {
    setError(null);
    setImportResult(null);
    try {
      const text = await decodeCsvFile(file);
      const preview = (await api.previewLeadImport(text)) as ImportPreview;
      setImportCsv(text);
      setImportPreview(preview);
      setImportMapping(preview.suggestedMapping);
      setShowForm(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function cancelImport() {
    setImportCsv(null);
    setImportPreview(null);
    setImportMapping({});
    setImportResult(null);
  }

  async function confirmImport() {
    if (!importCsv) return;
    setImporting(true);
    setError(null);
    try {
      const result = (await api.importLeads(importCsv, importMapping)) as ImportResult;
      setImportResult(result);
      setImportPreview(null);
      setImportCsv(null);
      invalidateLeads();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  async function exportCsv() {
    setExporting(true);
    setError(null);
    try {
      await downloadLeadsCsv();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExporting(false);
    }
  }

  // Cached: revisiting this tab shows the last-known list instantly while
  // quietly re-verifying in the background (staleTime in query-provider.tsx).
  const leadsQuery = useQuery({
    queryKey: ["leads"],
    queryFn: async () => {
      const res: any = await api.getLeads({ pageSize: "200" });
      return (res.items ?? res) as LeadRow[];
    },
  });
  // Stable empty-array identity when data is undefined -- `?? []` would mint
  // a new array every render and defeat the useMemo hooks below it.
  const leads = leadsQuery.data ?? EMPTY_LEADS;

  function invalidateLeads() {
    queryClient.invalidateQueries({ queryKey: ["leads"] });
  }

  // New leads land here live during a "Run now" extraction (or auto-discovery)
  // instead of only appearing after a manual refresh (Part: autonomous system).
  // lead.stageChanged also covers another tab/user promoting a batch to the
  // Pipeline — this page's own promoteToPipeline already invalidates
  // directly for the actor, this is for everyone else watching.
  useRealtimeRefetch(["lead.created", "lead.stageChanged"], invalidateLeads);

  // Filtered in the browser because the whole page is already loaded; going
  // back to the server for each keystroke would be slower and no more correct
  // at this size. Swap to server-side filtering past a few thousand leads.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (q && ![l.companyName, l.contactName, l.email, l.personalEmail, l.website].some((v) => v?.toLowerCase().includes(q))) return false;
      if (industry && l.industry !== industry) return false;
      if (country && l.country !== country) return false;
      if (stage && (l.pipelineState?.stage ?? "") !== stage) return false;
      if (source && l.sourceLayer !== source) return false;
      return true;
    });
  }, [leads, search, industry, country, stage, source]);

  const industries = useMemo(
    () => [...new Set(leads.map((l) => l.industry).filter(Boolean))].sort() as string[],
    [leads],
  );
  const countries = useMemo(
    () => [...new Set(leads.map((l) => l.country).filter(Boolean))].sort() as string[],
    [leads],
  );

  // Leads with no PipelineState row are sitting in Lead Room, un-promoted.
  const unpromotedLeads = useMemo(() => leads.filter((l) => !l.pipelineState), [leads]);
  const promoteMatchCount = useMemo(
    () => unpromotedLeads.filter((l) => !promoteSource || l.sourceLayer === promoteSource).length,
    [unpromotedLeads, promoteSource],
  );
  const promoteLimitNum = promoteLimit.trim() ? Number(promoteLimit) : null;
  const promoteCount = promoteLimitNum && promoteLimitNum < promoteMatchCount ? promoteLimitNum : promoteMatchCount;

  async function promoteToPipeline() {
    setPromoting(true);
    setError(null);
    setNotice(null);
    try {
      const result = (await api.promoteLeadsToPipeline({
        sourceLayer: promoteSource || undefined,
        limit: promoteLimitNum ?? undefined,
      })) as { promoted: number };
      setNotice(`Moved ${result.promoted} lead${result.promoted === 1 ? "" : "s"} to the Pipeline.`);
      setPromoteLimit("");
      invalidateLeads();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPromoting(false);
    }
  }

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
      invalidateLeads();
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
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">Leads</h1>
            {leadsQuery.isFetching && !leadsQuery.isLoading && <Spinner className="h-3.5 w-3.5" />}
          </div>
          <p className="mt-0.5 text-xs text-ink/55">
            {filtered.length === leads.length
              ? `${leads.length} leads`
              : `${filtered.length} of ${leads.length} leads`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={exporting || leads.length === 0}
            className="rounded-lg border border-[var(--line)] px-3.5 py-2 text-sm font-medium text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
          <label className="cursor-pointer rounded-lg border border-[var(--line)] px-3.5 py-2 text-sm font-medium text-ink/70 transition-colors hover:bg-ink/5">
            Import CSV
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = ""; // lets picking the same file twice still fire onChange
                if (file) handleImportFileSelected(file);
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setShowForm((v) => !v);
              cancelImport();
            }}
            className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90"
          >
            {showForm ? "Cancel" : "+ Add lead"}
          </button>
        </div>
      </div>

      {(error || leadsQuery.error) && (
        <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
          {error ?? (leadsQuery.error as Error).message}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-[rgb(var(--good-rgb)/0.4)] bg-[rgb(var(--good-rgb)/0.06)] px-3 py-2 text-sm text-good">
          {notice}
        </div>
      )}

      {importResult && (
        <div className="card p-5">
          <h2 className="mb-1 text-sm font-semibold tracking-tight">Import finished</h2>
          <p className="mt-2 text-sm text-ink/80">
            <span className="font-semibold text-good">{importResult.created} created</span>
            {importResult.duplicates > 0 && (
              <span className="text-ink/55"> · {importResult.duplicates} already existed, skipped</span>
            )}
            {importResult.failed.length > 0 && (
              <span className="text-bad"> · {importResult.failed.length} rows failed</span>
            )}
          </p>
          <p className="mt-1 text-xs text-ink/50">
            New leads start unverified and unscored, then run AI enrichment automatically,
            one lead at a time — each one lands in the table below as it is processed.
          </p>
          {importResult.failed.length > 0 && (
            <div className="mt-3 max-h-40 overflow-y-auto rounded-lg border border-[var(--line)] p-2 text-xs">
              {importResult.failed.map((f) => (
                <div key={f.row} className="border-t border-[var(--line)] py-1 first:border-t-0">
                  Row {f.row}: {f.reason}
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setImportResult(null)}
            className="mt-3 rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-ink/70 transition-colors hover:bg-ink/5"
          >
            Dismiss
          </button>
        </div>
      )}

      {importPreview && (
        <div className="card p-5">
          <h2 className="mb-1 text-sm font-semibold tracking-tight">Map your columns</h2>
          <p className="mb-4 text-xs text-ink/50">
            {importPreview.totalRows} row{importPreview.totalRows === 1 ? "" : "s"} found. Columns are
            matched automatically where possible — check them below and adjust anything mapped
            incorrectly or left unmapped before importing. Company name must be mapped for a row to import.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-ink/55">
                <tr className="border-b border-[var(--line)]">
                  <th className="py-2 pr-3">CSV column</th>
                  <th className="py-2 pr-3">Maps to</th>
                  <th className="py-2 pr-3">Preview</th>
                </tr>
              </thead>
              <tbody>
                {importPreview.headers.map((header) => {
                  const previewValues = importPreview.previewRows.map((r) => r[header]).filter(Boolean);
                  const mappedField = importMapping[header];
                  // Traced a real batch of imported leads where the "Email"
                  // column had been mapped to "Country" — every non-empty
                  // preview value looking like an email address, sitting
                  // under a field that isn't email/personalEmail, is exactly
                  // that mistake. A human catches this in a glance; nothing
                  // downstream validates a "country" cell for looking like
                  // an address, so this is the only place it gets caught.
                  const looksMisrouted =
                    mappedField &&
                    mappedField !== "email" &&
                    mappedField !== "personalEmail" &&
                    previewValues.length > 0 &&
                    previewValues.every((v) => EMAIL_LIKE.test(v));
                  return (
                  <tr key={header} className="border-b border-[var(--line)] last:border-0">
                    <td className="py-2 pr-3 font-medium text-ink/80">{header}</td>
                    <td className="py-2 pr-3">
                      <select
                        value={importMapping[header] ?? ""}
                        onChange={(e) =>
                          setImportMapping((m) => ({ ...m, [header]: e.target.value || null }))
                        }
                        className={`rounded-lg border bg-transparent px-2 py-1 text-sm outline-none focus:border-[rgb(var(--accent-rgb)/0.6)] ${
                          looksMisrouted ? "border-bad" : "border-[var(--line)]"
                        }`}
                      >
                        <option value="">Do not import</option>
                        {IMPORTABLE_FIELDS.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                      {looksMisrouted && (
                        <p className="mt-1 text-[11px] text-bad">
                          These values look like email addresses — check this is really {" "}
                          {IMPORTABLE_FIELDS.find((f) => f.key === mappedField)?.label ?? mappedField}.
                        </p>
                      )}
                    </td>
                    <td className="max-w-[220px] truncate py-2 pr-3 text-ink/50" title={importPreview.previewRows[0]?.[header]}>
                      {importPreview.previewRows.slice(0, 2).map((r) => r[header]).filter(Boolean).join(" · ") || "—"}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={confirmImport}
              disabled={importing || !Object.values(importMapping).includes("companyName")}
              className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
              title={
                Object.values(importMapping).includes("companyName")
                  ? undefined
                  : "Map a column to Company name to enable import"
              }
            >
              {importing ? "Importing…" : `Import ${importPreview.totalRows} lead${importPreview.totalRows === 1 ? "" : "s"}`}
            </button>
            <button
              type="button"
              onClick={cancelImport}
              disabled={importing}
              className="rounded-lg border border-[var(--line)] px-3.5 py-2 text-sm text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
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
              ["personalEmail", "Personal email", "jordan.blake@gmail.com"],
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
                  type={key === "email" || key === "personalEmail" ? "email" : "text"}
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

      <div className="card flex flex-wrap items-end gap-3 border-[rgb(var(--accent-rgb)/0.25)] bg-[rgb(var(--accent-rgb)/0.03)] p-4">
        <div className="min-w-[160px]">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink/55">Move to Pipeline</span>
          <p className="text-xs text-ink/50">
            {unpromotedLeads.length} lead{unpromotedLeads.length === 1 ? "" : "s"} waiting in Lead Room.
          </p>
        </div>
        <label>
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink/55">Source</span>
          <select
            value={promoteSource}
            onChange={(e) => setPromoteSource(e.target.value)}
            className="rounded-lg border border-[var(--line)] bg-transparent px-3 py-1.5 text-sm outline-none"
          >
            <option value="">All sources</option>
            {Object.entries(SOURCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink/55">How many</span>
          <input
            type="number"
            min={1}
            value={promoteLimit}
            onChange={(e) => setPromoteLimit(e.target.value)}
            placeholder={`All (${promoteMatchCount})`}
            className="w-28 rounded-lg border border-[var(--line)] bg-transparent px-3 py-1.5 text-sm outline-none"
          />
        </label>
        <button
          type="button"
          onClick={promoteToPipeline}
          disabled={promoting || promoteCount === 0 || (promoteLimitNum !== null && promoteLimitNum <= 0)}
          className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {promoting ? "Moving…" : `Move ${promoteCount} to Pipeline`}
        </button>
      </div>

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
        <label>
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink/55">Source</span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="rounded-lg border border-[var(--line)] bg-transparent px-3 py-1.5 text-sm outline-none"
          >
            <option value="">All</option>
            {Object.entries(SOURCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        {(search || industry || country || stage || source) && (
          <button
            type="button"
            onClick={() => { setSearch(""); setIndustry(""); setCountry(""); setStage(""); setSource(""); }}
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-ink/70 hover:bg-ink/5"
          >
            Clear
          </button>
        )}
      </div>

      {leadsQuery.isLoading ? (
        <div className="card">
          <LoadingRow label="Loading leads…" />
        </div>
      ) : (
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b border-[var(--line)] text-left text-[11px] uppercase tracking-wide text-ink/55">
            <tr>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Source</th>
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
                <td className="px-4 py-3"><SourceBadge source={lead.sourceLayer} /></td>
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
                <td className="px-4 py-3 text-ink/60">
                  {lead.email ?? <span className="text-ink/40">—</span>}
                  {lead.personalEmail && (
                    <div className="text-[11px] text-ink/40" title="Personal email">{lead.personalEmail}</div>
                  )}
                </td>
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
                <td colSpan={9} className="px-4 py-10 text-center text-ink/50">
                  {leads.length === 0
                    ? "No leads yet — configure a niche filter in Settings, or add one manually above."
                    : "No leads match these filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
