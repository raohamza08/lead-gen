"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, downloadLeadsCsv, getCurrentUser } from "../../../lib/api-client";
import { useRealtimeEvent, useRealtimeRefetch } from "../../../lib/realtime";
import { PipelineStage } from "@leadgen/types";
import type { Lead, LeadScore } from "@leadgen/types";
import { LoadingRow, Spinner } from "../../../components/spinner";
import { Button } from "../../../components/ui/button";
import { StatusBadge } from "../../../components/ui/status-badge";
import { Table, TableHead, TableHeadRow, Th, TableBody, Tr, Td, TableEmptyRow } from "../../../components/ui/table";

interface LeadRow extends Lead {
  score: LeadScore | null;
  pipelineState: { stage: string } | null;
  // Part: Lead Upload Analytics, 2026-09-01 — absent for an AI-discovered lead.
  uploadedByUser?: { id: string; name: string } | null;
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
  return <StatusBadge tone="neutral" label={SOURCE_LABELS[source] ?? source} />;
}

function StagePill({ stage }: { stage?: string | null }) {
  // No PipelineState row at all means this lead hasn't been promoted out of
  // Lead Room yet (Part: Lead Room / Move to Pipeline) — distinct from any
  // real stage, so it gets its own badge rather than reading as "unknown".
  if (!stage) return <StatusBadge tone="warning" label="Lead Room" />;
  const won = stage === PipelineStage.WON || stage === PipelineStage.CLIENT_ONBOARDING;
  const lost = stage === PipelineStage.LOST;
  const label = stage.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
  return <StatusBadge tone={won ? "success" : lost ? "error" : "neutral"} label={label} />;
}

export default function LeadsPage() {
  const queryClient = useQueryClient();
  const isAdmin = getCurrentUser()?.role === "ADMIN";
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Admin-only bulk delete — a user-picked set of rows, not a filter-based
  // batch like Pipeline's "Delete stage" (removeByStage) or Lead Room's own
  // "Move to Pipeline" (source + count).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<{ done: number; total: number } | null>(null);

  // Filters — server-side (Part: performance audit, 2026-09-02; the backend
  // already supported these query params, the page just wasn't passing them,
  // fetching the entire org's leads and filtering in the browser instead).
  const [search, setSearch] = useState("");
  // Debounced separately from `search` so the input feels instant while the
  // network request (now one per keystroke's worth of typing, not free
  // client-side filtering) only fires once typing pauses (spec #39).
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);
  const [industry, setIndustry] = useState("");
  const [country, setCountry] = useState("");
  const [stage, setStage] = useState("");
  const [source, setSource] = useState("");
  const [page, setPage] = useState(1);
  // Any filter change invalidates whatever page you were on — landing on
  // page 5 of a now-much-smaller filtered result set would either show
  // nothing or read past the end silently.
  useEffect(() => setPage(1), [debouncedSearch, industry, country, stage, source]);

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
  // Real progress, not a fake animated bar — importLeads emits a real
  // "lead.created" event per row as it's actually inserted server-side
  // (SyncService.onLeadCreated), so counting those live gives an accurate
  // in-flight percentage instead of just a spinner until the whole batch
  // (which can be hundreds of rows) finishes.
  // Not guarded on `importing`: the hook only resubscribes when the event
  // name changes (see useRealtimeEvent), so a closure over `importing` here
  // would go stale after the first render. Harmless either way — this only
  // gets read while importing is true, and is reset to 0 at the start of
  // every import.
  const [importCreated, setImportCreated] = useState(0);
  useRealtimeEvent<{ leadId: string }>("lead.created", () => {
    setImportCreated((n) => n + 1);
  });

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
    setImportCreated(0);
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

  const PAGE_SIZE = 50;

  // Cached per filter+page combination: revisiting the same page shows the
  // last-known list instantly while quietly re-verifying in the background
  // (staleTime in query-provider.tsx). Part: performance audit, 2026-09-02 —
  // this used to loop-fetch every page of the org's ENTIRE lead table (200 at
  // a time) before rendering anything; now it fetches exactly the one page
  // in view, filtered server-side.
  const leadsParams = {
    page: String(page),
    pageSize: String(PAGE_SIZE),
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(industry ? { industry } : {}),
    ...(country ? { country } : {}),
    ...(stage ? { stage } : {}),
    ...(source ? { sourceLayer: source } : {}),
  };
  const leadsQuery = useQuery({
    queryKey: ["leads", leadsParams],
    queryFn: () => api.getLeads(leadsParams) as Promise<{ items: LeadRow[]; total: number }>,
  });
  const leads = leadsQuery.data?.items ?? EMPTY_LEADS;
  const total = leadsQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function invalidateLeads() {
    queryClient.invalidateQueries({ queryKey: ["leads"] });
  }

  // New leads land here live during a "Run now" extraction (or auto-discovery)
  // instead of only appearing after a manual refresh (Part: autonomous system).
  // lead.stageChanged also covers another tab/user promoting a batch to the
  // Pipeline — this page's own promoteToPipeline already invalidates
  // directly for the actor, this is for everyone else watching.
  useRealtimeRefetch(["lead.created", "lead.stageChanged"], invalidateLeads);

  // Filter dropdown options — their own small, cached, org-wide query
  // (Part: performance audit, 2026-09-02) rather than derived from whatever
  // happens to be on the currently-loaded page, now that the page is a real
  // slice instead of the whole table.
  const filterOptionsQuery = useQuery({
    queryKey: ["leads", "filter-options"],
    queryFn: () => api.getLeadFilterOptions(),
  });
  const industries = filterOptionsQuery.data?.industries ?? [];
  const countries = filterOptionsQuery.data?.countries ?? [];

  // Live preview for "Move N to Pipeline" — a dedicated count query using
  // promoteToPipeline's exact filter, instead of requiring every un-promoted
  // lead to be loaded client-side just to count a subset of them. The
  // unfiltered total (for the "N leads waiting in Lead Room" line) is the
  // same query with no source, cached separately.
  const allUnpromotedQuery = useQuery({
    queryKey: ["leads", "promote-preview", ""],
    queryFn: () => api.getPromotePreviewCount(),
  });
  const promotePreviewQuery = useQuery({
    queryKey: ["leads", "promote-preview", promoteSource],
    queryFn: () => api.getPromotePreviewCount(promoteSource || undefined),
    enabled: promoteSource !== "",
  });
  const totalUnpromoted = allUnpromotedQuery.data?.count ?? 0;
  const promoteMatchCount = promoteSource ? promotePreviewQuery.data?.count ?? 0 : totalUnpromoted;
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
      queryClient.invalidateQueries({ queryKey: ["leads", "promote-preview"] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPromoting(false);
    }
  }

  function toggleOne(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((s) => {
      const allVisibleSelected = leads.length > 0 && leads.every((l) => s.has(l.id));
      if (allVisibleSelected) return new Set();
      return new Set(leads.map((l) => l.id));
    });
  }

  /** Admin-only — same no-detach-and-keep, full-history-wipe semantics as
   *  every other lead delete in this app. Deletes one at a time (not the
   *  single bulk-delete call) specifically so progress is real, not a fake
   *  animated bar — each lead removed from the table and the percentage
   *  bumped only once its own delete has actually completed. One failure
   *  doesn't stop the rest; failures are counted and reported at the end. */
  async function deleteSelected() {
    const ids = [...selected];
    const total = ids.length;
    if (total === 0) return;
    if (
      !window.confirm(
        `Permanently delete ${total} selected lead${total === 1 ? "" : "s"}?\n\n` +
          "This removes their full history — scores, review notes, and any emails already sent — and cannot be undone.",
      )
    )
      return;

    setDeletingSelected(true);
    setError(null);
    setNotice(null);
    setDeleteProgress({ done: 0, total });

    let succeeded = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await api.deleteLead(id);
        succeeded += 1;
        setSelected((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      } catch {
        failed += 1;
      }
      setDeleteProgress((p) => (p ? { done: p.done + 1, total: p.total } : p));
    }
    // One invalidate after the whole batch, not per-item — the query key now
    // carries the current filter/page (Part: performance audit, 2026-09-02),
    // so there's no longer one single cache entry to hand-patch per delete.
    invalidateLeads();

    setNotice(
      failed === 0
        ? `Deleted ${succeeded} lead${succeeded === 1 ? "" : "s"}.`
        : `Deleted ${succeeded} of ${total} — ${failed} failed.`,
    );
    if (failed > 0) setError(`${failed} lead${failed === 1 ? "" : "s"} could not be deleted.`);
    setDeletingSelected(false);
    setDeleteProgress(null);
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
            {total.toLocaleString()} lead{total === 1 ? "" : "s"}
            {pageCount > 1 && ` · page ${page} of ${pageCount}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && selected.size > 0 && (
            <Button type="button" variant="danger" onClick={deleteSelected} disabled={deletingSelected}>
              {deleteProgress
                ? `Deleting… ${Math.round((deleteProgress.done / deleteProgress.total) * 100)}% (${deleteProgress.done}/${deleteProgress.total})`
                : `Delete selected (${selected.size})`}
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={exportCsv} disabled={exporting || leads.length === 0} loading={exporting}>
            Export CSV
          </Button>
          <label className="cursor-pointer rounded-lg border border-[var(--line)] px-3.5 py-2 text-sm font-medium text-ink/70 transition-colors duration-fast hover:bg-ink/5">
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
          <Button
            type="button"
            onClick={() => {
              setShowForm((v) => !v);
              cancelImport();
            }}
          >
            {showForm ? "Cancel" : "+ Add lead"}
          </Button>
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
          <Button type="button" variant="secondary" size="sm" onClick={() => setImportResult(null)} className="mt-3">
            Dismiss
          </Button>
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
            <Button
              type="button"
              onClick={confirmImport}
              disabled={importing || !Object.values(importMapping).includes("companyName")}
              title={
                Object.values(importMapping).includes("companyName")
                  ? undefined
                  : "Map a column to Company name to enable import"
              }
            >
              {importing
                ? `Importing… ${Math.min(100, Math.round((importCreated / importPreview.totalRows) * 100))}% (${importCreated}/${importPreview.totalRows})`
                : `Import ${importPreview.totalRows} lead${importPreview.totalRows === 1 ? "" : "s"}`}
            </Button>
            <Button type="button" variant="secondary" onClick={cancelImport} disabled={importing}>
              Cancel
            </Button>
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
          <Button type="submit" disabled={saving || !draft.companyName.trim()} loading={saving} className="mt-4">
            Add lead
          </Button>
        </form>
      )}

      <div className="card flex flex-wrap items-end gap-3 border-[rgb(var(--accent-rgb)/0.25)] bg-[rgb(var(--accent-rgb)/0.03)] p-4">
        <div className="min-w-[160px]">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink/55">Move to Pipeline</span>
          <p className="text-xs text-ink/50">
            {totalUnpromoted} lead{totalUnpromoted === 1 ? "" : "s"} waiting in Lead Room.
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
        <Button
          type="button"
          onClick={promoteToPipeline}
          disabled={promoting || promoteCount === 0 || (promoteLimitNum !== null && promoteLimitNum <= 0)}
          loading={promoting}
        >
          {`Move ${promoteCount} to Pipeline`}
        </Button>
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
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => { setSearch(""); setIndustry(""); setCountry(""); setStage(""); setSource(""); }}
          >
            Clear
          </Button>
        )}
      </div>

      {leadsQuery.isLoading ? (
        <div className="card">
          <LoadingRow label="Loading leads…" />
        </div>
      ) : (
      <>
      <Table>
        <TableHead>
          <TableHeadRow>
            {isAdmin && (
              <Th className="w-8">
                <input
                  type="checkbox"
                  checked={leads.length > 0 && leads.every((l) => selected.has(l.id))}
                  onChange={toggleAllVisible}
                  aria-label="Select all visible leads"
                />
              </Th>
            )}
            <Th>Company</Th>
            <Th>Source</Th>
            <Th>Industry</Th>
            <Th>Country</Th>
            <Th>Decision maker</Th>
            <Th>Email</Th>
            <Th className="text-right">Score</Th>
            <Th className="text-right">AI opp.</Th>
            <Th>Stage</Th>
          </TableHeadRow>
        </TableHead>
        <TableBody>
          {leads.map((lead) => (
            <Tr key={lead.id}>
              {isAdmin && (
                <Td>
                  <span onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(lead.id)}
                      onChange={() => toggleOne(lead.id)}
                      aria-label={`Select ${lead.companyName}`}
                    />
                  </span>
                </Td>
              )}
              <Td>
                <Link href={`/leads/${lead.id}`} className="font-medium text-primary hover:underline">
                  {lead.companyName}
                </Link>
                {lead.website && (
                  <div className="mt-0.5 truncate text-[11px] text-ink/45">
                    {lead.website.replace(/^https?:\/\//, "")}
                  </div>
                )}
                {lead.uploadedByUser && (
                  <div className="mt-0.5 truncate text-[11px] text-ink/40" title={`Uploaded by ${lead.uploadedByUser.name}`}>
                    Uploaded by {lead.uploadedByUser.name}
                  </div>
                )}
              </Td>
              <Td><SourceBadge source={lead.sourceLayer} /></Td>
              <Td className="text-ink/70">{lead.industry ?? "—"}</Td>
              <Td className="text-ink/70">{lead.country ?? "—"}</Td>
              <Td>
                {lead.contactName ? (
                  <>
                    <div className="text-ink/80">{lead.contactName}</div>
                    {lead.jobTitle && <div className="text-[11px] text-ink/45">{lead.jobTitle}</div>}
                  </>
                ) : <span className="text-ink/40">—</span>}
              </Td>
              <Td className="text-ink/60">
                {lead.email ?? <span className="text-ink/40">—</span>}
                {lead.personalEmail && (
                  <div className="text-[11px] text-ink/40" title="Personal email">{lead.personalEmail}</div>
                )}
              </Td>
              <Td className={`tabular text-right font-semibold ${scoreTone(lead.score?.leadScore)}`}>
                {lead.score?.leadScore ?? "—"}
              </Td>
              <Td className={`tabular text-right ${scoreTone(lead.score?.aiOpportunityScore)}`}>
                {lead.score?.aiOpportunityScore ?? "—"}
              </Td>
              <Td><StagePill stage={lead.pipelineState?.stage} /></Td>
            </Tr>
          ))}
          {leads.length === 0 && (
            <TableEmptyRow colSpan={isAdmin ? 10 : 9}>
              {total === 0 && !search && !industry && !country && !stage && !source
                ? "No leads yet — configure a niche filter in Settings, or add one manually above."
                : "No leads match these filters."}
            </TableEmptyRow>
          )}
        </TableBody>
      </Table>
      {pageCount > 1 && (
        <div className="card flex items-center justify-between px-4 py-3 text-xs text-ink/60">
          <Button type="button" variant="secondary" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            Previous
          </Button>
          <span>Page {page} of {pageCount}</span>
          <Button type="button" variant="secondary" size="sm" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount}>
            Next
          </Button>
        </div>
      )}
      </>
      )}
    </div>
  );
}
