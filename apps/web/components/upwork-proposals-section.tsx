"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, getCurrentUser, downloadUpworkProposalsCsv } from "../lib/api-client";
import { DataTable, type TableColumn } from "./chart-kit";
import { useDateFilter } from "../lib/use-date-filter";
import { DateRangeFilter } from "./ui/date-range-filter";
import { UpworkPicklistManager } from "./upwork-picklist-manager";
import { Modal } from "./ui/modal";
import { Button } from "./ui/button";

export type UpworkProposalType = "BIDDING" | "INVITE";
type UpworkProposalStatus =
  | "SUBMITTED"
  | "VIEWED"
  | "IN_DISCUSSION"
  | "TEST_TASK"
  | "MEETING"
  | "FOLLOW_UP_1"
  | "FOLLOW_UP_2"
  | "FOLLOW_UP_3"
  | "WON"
  | "LOST";
type UpworkAccountType = "TRAINING" | "LIVE";
type UpworkProjectPricingType = "HOURLY" | "FIXED";
type UpworkServiceFeeType = "PERCENT" | "FIXED";

interface UpworkProposal {
  id: string;
  type: UpworkProposalType;
  profileName: string;
  jobCategory: string;
  jobLink: string;
  coverLetter: string;
  connects: number | null;
  accountType: UpworkAccountType | null;
  projectHours: number | null;
  pricingType: UpworkProjectPricingType;
  submittedBy: string;
  clickupTaskId: string | null;
  clientName: string | null;
  status: UpworkProposalStatus;
  closedBy: string | null;
  createdAt: string;
  acceptedAt: string | null;
  // Stamped the moment status first becomes WON — "winning date" in the
  // earnings panel below (Part: Upwork earnings tracking, 2026-10-28).
  onboardedAt: string | null;
  notifyUserIds: string[];
  // Earnings tracking — Prisma Decimal columns come back from the API as
  // numeric strings (same convention as Lead.score.expectedValue), hence
  // `string | null` rather than `number | null`; always run through
  // Number(...) before doing math, same as every other money field in
  // this app already does.
  clientEarnings: string | null;
  serviceFeeType: UpworkServiceFeeType | null;
  serviceFeeValue: string | null;
  serviceFeeAmount: string | null;
  netEarnings: string | null;
}

interface OrgUser {
  id: string;
  name: string;
  active: boolean;
}

const STATUS_OPTIONS: { value: UpworkProposalStatus; label: string }[] = [
  { value: "SUBMITTED", label: "Submitted" },
  { value: "VIEWED", label: "Viewed" },
  { value: "IN_DISCUSSION", label: "In discussion" },
  { value: "TEST_TASK", label: "Test task" },
  { value: "MEETING", label: "Meeting" },
  { value: "FOLLOW_UP_1", label: "1st follow-up" },
  { value: "FOLLOW_UP_2", label: "2nd follow-up" },
  { value: "FOLLOW_UP_3", label: "3rd follow-up" },
  { value: "WON", label: "Client won" },
  { value: "LOST", label: "Lost" },
];

const STATUS_TONE: Record<UpworkProposalStatus, string> = {
  SUBMITTED: "text-ink/60",
  VIEWED: "text-ink/60",
  IN_DISCUSSION: "text-gold",
  TEST_TASK: "text-gold",
  MEETING: "text-gold",
  FOLLOW_UP_1: "text-gold",
  FOLLOW_UP_2: "text-gold",
  FOLLOW_UP_3: "text-gold",
  WON: "text-good",
  LOST: "text-bad",
};

interface UpworkPicklists {
  categories: string[];
  submitters: string[];
  profiles: string[];
}

const inputClass = "w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm";
const labelClass = "mb-1 block text-xs text-ink/60";

/** `v` is a Prisma Decimal column as it comes back over JSON — a numeric
 *  string, or null when never entered (Part: Upwork earnings tracking,
 *  2026-10-28). Never defaults to $0 — a null stays "—", matching the
 *  backend's own "missing fee isn't zero" rule. */
function formatMoney(v: string | number | null): string {
  if (v === null) return "—";
  const n = Number(v);
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Replaces the team's daily Upwork Proposals Google Form + Sheet (Part:
 * Upwork Proposals, 2026-09-29) — one form/list per proposal type (Bidding /
 * Invite), backed by the same UpworkProposal table server-side. Field names
 * mirror the original sheet's columns 1:1 so nothing has to be relearned.
 */
const PAGE_SIZE = 100;

export function UpworkProposalsSection({ type }: { type: UpworkProposalType }) {
  const role = getCurrentUser()?.role;
  const isAdmin = role === "ADMIN";
  // Earnings is financial data — same ADMIN/MANAGER bar the backend
  // enforces in UpworkService.update (Part: Upwork earnings tracking,
  // 2026-10-28). Everyone can still see the entered figures; only these
  // two roles get the "add/edit earnings" entry points.
  const canEditEarnings = role === "ADMIN" || role === "MANAGER";
  const [items, setItems] = useState<UpworkProposal[] | null>(null);
  // Client-side, current page only (Part: table filter/KPI rollout,
  // 2026-10-27) — this list is server-paginated, so a true full-dataset
  // date filter would need a backend dateFrom/dateTo param; left as a
  // known limitation, same as the earlier sort rollout's own.
  const { filteredRows: dateFilteredItems, from: dateFrom, to: dateTo, setFrom: setDateFrom, setTo: setDateTo, clear: clearDateFilter } = useDateFilter(
    items ?? [],
    (r) => r.createdAt,
  );
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<UpworkProposalStatus | "">("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [followUpTarget, setFollowUpTarget] = useState<UpworkProposal | null>(null);
  const [detailTarget, setDetailTarget] = useState<UpworkProposal | null>(null);
  const [earningsTarget, setEarningsTarget] = useState<UpworkProposal | null>(null);

  const [profileName, setProfileName] = useState("");
  const [jobCategory, setJobCategory] = useState("");
  const [jobLink, setJobLink] = useState("");
  const [coverLetter, setCoverLetter] = useState("");
  const [submittedBy, setSubmittedBy] = useState("");
  const [connects, setConnects] = useState("");
  const [accountType, setAccountType] = useState<UpworkAccountType>("LIVE");
  const [projectHours, setProjectHours] = useState("");
  const [pricingType, setPricingType] = useState<UpworkProjectPricingType>("HOURLY");
  const [clientName, setClientName] = useState("");

  const { data: picklists } = useQuery({
    queryKey: ["upwork-picklists"],
    queryFn: () => api.getUpworkPicklists() as Promise<UpworkPicklists>,
  });

  // "Submitted by" is the logged-in account's own name, picked up
  // automatically — not a manual dropdown choice — for both Bidding and
  // Invite (same form). The server re-derives this from the auth token
  // anyway (UpworkService.create), so this is purely for display.
  const { data: me } = useQuery({ queryKey: ["me-for-upwork-submitter"], queryFn: () => api.getMe() as Promise<{ name: string }> });
  useEffect(() => {
    if (me?.name) setSubmittedBy(me.name);
  }, [me]);

  function load() {
    api
      .getUpworkProposals({
        type,
        page: String(page),
        pageSize: String(PAGE_SIZE),
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
      })
      .then((res) => {
        const r = res as { items: UpworkProposal[]; total: number };
        setItems(r.items);
        setTotal(r.total);
      })
      .catch((err) => setError((err as Error).message));
  }

  useEffect(load, [type, page, statusFilter, search]);

  // Changing a filter resets to page 1 in the same update, not a separate
  // effect — otherwise the page-1 reset and the filter change would fire as
  // two effects back to back, each triggering its own fetch.
  function setStatusFilterAndReset(v: UpworkProposalStatus | "") { setStatusFilter(v); setPage(1); }
  function setSearchAndReset(v: string) { setSearch(v); setPage(1); }

  /** Exports whatever's currently filtered on screen, not always everything
   *  — same type/status/search the list view itself is using. */
  async function exportCsv() {
    setExporting(true);
    setError(null);
    try {
      await downloadUpworkProposalsCsv({
        type,
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExporting(false);
    }
  }

  function resetForm() {
    setProfileName(""); setJobCategory(""); setJobLink(""); setCoverLetter("");
    setConnects(""); setAccountType("LIVE"); setProjectHours(""); setPricingType("HOURLY"); setClientName("");
    // submittedBy is left alone — it's the auto-filled account name, not a
    // form field that should clear between submissions.
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await api.createUpworkProposal({
        type,
        profileName,
        jobCategory,
        jobLink,
        coverLetter,
        submittedBy,
        clientName: clientName.trim() || undefined,
        projectHours: projectHours ? Number(projectHours) : undefined,
        pricingType,
        ...(type === "BIDDING"
          ? { connects: connects ? Number(connects) : undefined, accountType }
          : {}),
      });
      resetForm();
      setShowForm(false);
      setNotice("Proposal logged.");
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function updateField(id: string, body: Record<string, unknown>) {
    setSavingId(id);
    setError(null);
    try {
      const updated = (await api.updateUpworkProposal(id, body)) as UpworkProposal;
      setItems((prev) => prev?.map((p) => (p.id === id ? updated : p)) ?? null);
      // Prompt for earnings the moment a proposal is first marked Won, if
      // nobody's entered them yet (Part: Upwork earnings tracking,
      // 2026-10-28, explicit spec request — "when a team member marks a
      // bid or invite as Client Won, they should be able to enter the
      // relevant earnings information"). Only fires on the inline status
      // dropdown's own transition, not every re-save of an already-Won row.
      if (body.status === "WON" && updated.clientEarnings === null && canEditEarnings) {
        setEarningsTarget(updated);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api.deleteUpworkProposal(id);
      setItems((prev) => prev?.filter((p) => p.id !== id) ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const columns: TableColumn<UpworkProposal>[] = [
    { key: "view", header: "", render: (r) => (
      <button onClick={() => setDetailTarget(r)} className="text-xs text-accent hover:underline" title="View and edit all fields">
        Open
      </button>
    ) },
    { key: "createdAt", header: "Date", render: (r) => new Date(r.createdAt).toLocaleDateString(), sortValue: (r) => new Date(r.createdAt).getTime() },
    { key: "profileName", header: "Profile", render: (r) => r.profileName, sortValue: (r) => r.profileName },
    { key: "jobCategory", header: "Category", render: (r) => r.jobCategory, sortValue: (r) => r.jobCategory },
    ...(type === "BIDDING"
      ? [{ key: "connects", header: "Connects", numeric: true, render: (r: UpworkProposal) => r.connects ?? "—", sortValue: (r: UpworkProposal) => r.connects } as TableColumn<UpworkProposal>]
      : []),
    // Every invite is accepted by a real person before anything else happens
    // to it — for this type, "Submitted by" IS "who accepted the invite",
    // not a literal submission (Part: Upwork Invites, 2026-09-30), so the
    // column header reflects that instead of reusing Bidding's wording.
    { key: "submittedBy", header: type === "INVITE" ? "Accepted by" : "Submitted by", render: (r) => r.submittedBy, sortValue: (r) => r.submittedBy },
    { key: "jobLink", header: "Job", render: (r) => (
      <a href={r.jobLink} target="_blank" rel="noreferrer" className="text-accent hover:underline">Open ↗</a>
    ) },
    { key: "projectHours", header: "Project Hours", numeric: true, sortValue: (r) => r.projectHours, render: (r) => (
      <div className="flex items-center justify-end gap-1">
        <select
          value={r.pricingType}
          onChange={(e) => updateField(r.id, { pricingType: e.target.value })}
          className="rounded border border-transparent bg-transparent px-0.5 py-0.5 text-[11px] text-ink/50 hover:border-[var(--line)] focus:border-[var(--line)]"
        >
          <option value="HOURLY">Hourly</option>
          <option value="FIXED">Fixed</option>
        </select>
        {r.pricingType === "FIXED" ? (
          <span className="w-16 px-1 text-xs text-ink/50">Fixed</span>
        ) : (
          <input
            defaultValue={r.projectHours ?? ""}
            placeholder="—"
            type="number"
            min={0}
            step="0.5"
            onBlur={(e) => {
              const next = e.target.value === "" ? null : Number(e.target.value);
              if (next !== r.projectHours) updateField(r.id, { projectHours: next });
            }}
            className="w-16 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-[var(--line)] focus:border-[var(--line)]"
          />
        )}
      </div>
    ) },
    { key: "status", header: "Status", sortValue: (r) => r.status, render: (r) => (
      <select
        value={r.status}
        disabled={savingId === r.id}
        onChange={(e) => updateField(r.id, { status: e.target.value })}
        className={`rounded border border-[var(--line)] bg-transparent px-1.5 py-1 text-xs ${STATUS_TONE[r.status]}`}
      >
        {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    ) },
    { key: "clientName", header: "Client", sortValue: (r) => r.clientName, render: (r) => (
      <input
        defaultValue={r.clientName ?? ""}
        placeholder="—"
        onBlur={(e) => { if (e.target.value !== (r.clientName ?? "")) updateField(r.id, { clientName: e.target.value || null }); }}
        className="w-28 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-[var(--line)] focus:border-[var(--line)]"
      />
    ) },
    // Earnings tracking (Part: Upwork earnings tracking, 2026-10-28) — only
    // ever meaningful once a row is actually WON, so every cell below reads
    // "—" otherwise rather than showing a stale/pre-win figure. "Client
    // Earnings" doubles as the edit trigger (click → EarningsModal) for
    // ADMIN/MANAGER on a Won row; the fee/net columns are pure derived
    // display, never directly editable.
    { key: "onboardedAt", header: "Winning Date", sortValue: (r) => (r.onboardedAt ? new Date(r.onboardedAt).getTime() : null), render: (r) => (
      r.onboardedAt ? new Date(r.onboardedAt).toLocaleDateString() : "—"
    ) },
    { key: "clientEarnings", header: "Client Earnings", numeric: true, sortValue: (r) => (r.clientEarnings !== null ? Number(r.clientEarnings) : null), render: (r) => (
      r.status !== "WON" ? (
        <span className="text-ink/40">—</span>
      ) : canEditEarnings ? (
        <button onClick={() => setEarningsTarget(r)} className="text-xs text-accent hover:underline">
          {r.clientEarnings !== null ? formatMoney(r.clientEarnings) : "+ Add"}
        </button>
      ) : (
        <span>{formatMoney(r.clientEarnings)}</span>
      )
    ) },
    { key: "serviceFeeAmount", header: "Upwork Service Fee", numeric: true, sortValue: (r) => (r.serviceFeeAmount !== null ? Number(r.serviceFeeAmount) : null), render: (r) => (
      <span className={r.status === "WON" ? "" : "text-ink/40"}>{r.status === "WON" ? formatMoney(r.serviceFeeAmount) : "—"}</span>
    ) },
    { key: "netEarnings", header: "Net Earnings", numeric: true, sortValue: (r) => (r.netEarnings !== null ? Number(r.netEarnings) : null), render: (r) => (
      <span className={r.status === "WON" ? "font-medium" : "text-ink/40"}>{r.status === "WON" ? formatMoney(r.netEarnings) : "—"}</span>
    ) },
    // Closed By is dropped for invites (Part: Upwork Invites, 2026-09-30) —
    // Won/Lost is set from the Status dropdown above, which is the only
    // place that should change it; a separate free-text "closed by" field
    // was a second, untracked path to the same outcome. Still shown on
    // Bidding, unchanged.
    ...(type === "INVITE"
      ? []
      : [
          {
            key: "closedBy",
            header: "Closed by",
            sortValue: (r: UpworkProposal) => r.closedBy,
            render: (r: UpworkProposal) => (
              <input
                defaultValue={r.closedBy ?? ""}
                placeholder="—"
                onBlur={(e) => { if (e.target.value !== (r.closedBy ?? "")) updateField(r.id, { closedBy: e.target.value || null }); }}
                className="w-24 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-[var(--line)] focus:border-[var(--line)]"
              />
            ),
          } as TableColumn<UpworkProposal>,
        ]),
    // Follow-up reminders are invite-only and admin-only (Part: Upwork
    // follow-up reminders, 2026-09-30) — the automatic 2-day nudge only
    // ever applies once an invite is ACCEPTED, and choosing who gets
    // pinged about a client relationship is an org-level call.
    ...(type === "INVITE" && isAdmin
      ? [
          {
            key: "followUp",
            header: "Follow-up",
            render: (r: UpworkProposal) => (
              <button onClick={() => setFollowUpTarget(r)} className="text-xs text-accent hover:underline">
                {r.notifyUserIds.length > 0 ? `${r.notifyUserIds.length} notified` : "Set reminder"}
              </button>
            ),
          } as TableColumn<UpworkProposal>,
        ]
      : []),
    { key: "actions", header: "", render: (r) => (
      <button onClick={() => remove(r.id)} className="text-xs text-bad hover:underline">Delete</button>
    ) },
  ];

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">{type === "BIDDING" ? "Bidding" : "Invite"} proposals</h2>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={exportCsv}
              disabled={exporting}
              className="rounded-md border border-[var(--line)] px-3 py-1.5 text-xs hover:bg-ink/5 disabled:opacity-50"
              title={`Export ${type === "BIDDING" ? "bidding" : "invite"} proposals matching the current filters as CSV`}
            >
              {exporting ? "Exporting…" : "Export CSV"}
            </button>
          )}
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-md border border-[var(--line)] px-3 py-1.5 text-xs hover:bg-ink/5"
          >
            {showForm ? "Cancel" : "Log a proposal"}
          </button>
        </div>
      </div>

      <UpworkPicklistManager />

      <EarningsSummaryPanel type={type} />

      {error && (
        <div className="mb-3 mt-3 rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-3 mt-3 rounded-lg border border-[rgb(var(--good-rgb)/0.4)] bg-[rgb(var(--good-rgb)/0.06)] px-3 py-2 text-sm text-good">
          {notice}
        </div>
      )}

      {showForm && (
        <form onSubmit={submit} className="mb-5 mt-4 grid gap-3 rounded-lg border border-[var(--line)] p-4 sm:grid-cols-2">
          {type === "INVITE" && (
            <label className="block sm:col-span-2">
              <span className={labelClass}>Client name</span>
              <input value={clientName} onChange={(e) => setClientName(e.target.value)} required className={inputClass} />
            </label>
          )}
          <label className="block">
            <span className={labelClass}>Upwork profile / ID name</span>
            <select value={profileName} onChange={(e) => setProfileName(e.target.value)} required className={inputClass}>
              <option value="" disabled>Select a profile…</option>
              {(picklists?.profiles ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            {picklists && picklists.profiles.length === 0 && (
              <span className="mt-1 block text-[11px] text-gold">No profiles yet — an admin needs to add some above.</span>
            )}
          </label>
          <label className="block">
            <span className={labelClass}>Job category</span>
            <select value={jobCategory} onChange={(e) => setJobCategory(e.target.value)} required className={inputClass}>
              <option value="" disabled>Select a category…</option>
              {(picklists?.categories ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {picklists && picklists.categories.length === 0 && (
              <span className="mt-1 block text-[11px] text-gold">No categories yet — an admin needs to add some above.</span>
            )}
          </label>
          <label className="block sm:col-span-2">
            <span className={labelClass}>Job link</span>
            <input value={jobLink} onChange={(e) => setJobLink(e.target.value)} required type="url" placeholder="https://www.upwork.com/jobs/..." className={inputClass} />
          </label>
          <label className="block sm:col-span-2">
            <span className={labelClass}>{type === "BIDDING" ? "Proposal / cover letter" : "Cover letter for invite"}</span>
            <textarea value={coverLetter} onChange={(e) => setCoverLetter(e.target.value)} required rows={5} className={inputClass} />
          </label>
          <label className="block">
            <span className={labelClass}>{type === "INVITE" ? "Accepted by" : "Submitted by"}</span>
            <input value={submittedBy || "Loading…"} disabled readOnly className={`${inputClass} text-ink/60`} />
            <span className="mt-1 block text-[11px] text-ink/50">Your own account name — set automatically, not picked.</span>
          </label>
          {type === "BIDDING" && (
            <>
              <label className="block">
                <span className={labelClass}>Connects spent</span>
                <input value={connects} onChange={(e) => setConnects(e.target.value)} type="number" min={0} className={inputClass} />
              </label>
              <label className="block">
                <span className={labelClass}>Bidding type</span>
                <select value={accountType} onChange={(e) => setAccountType(e.target.value as UpworkAccountType)} className={inputClass}>
                  <option value="LIVE">Live</option>
                  <option value="TRAINING">Training</option>
                </select>
              </label>
            </>
          )}
          <label className="block">
            <span className={labelClass}>Pricing</span>
            <select value={pricingType} onChange={(e) => setPricingType(e.target.value as UpworkProjectPricingType)} className={inputClass}>
              <option value="HOURLY">Hourly</option>
              <option value="FIXED">Fixed-price</option>
            </select>
          </label>
          {pricingType === "HOURLY" && (
            <label className="block">
              <span className={labelClass}>Project hours (if known)</span>
              <input value={projectHours} onChange={(e) => setProjectHours(e.target.value)} type="number" min={0} step="0.5" placeholder="e.g. 20" className={inputClass} />
            </label>
          )}
          {type === "BIDDING" && (
            <label className="block">
              <span className={labelClass}>Client name (optional)</span>
              <input value={clientName} onChange={(e) => setClientName(e.target.value)} className={inputClass} />
            </label>
          )}
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={
                submitting ||
                !profileName ||
                !jobCategory ||
                !jobLink ||
                !coverLetter ||
                !submittedBy ||
                (type === "INVITE" && !clientName.trim())
              }
              className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Log proposal"}
            </button>
          </div>
        </form>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearchAndReset(e.target.value)}
          placeholder="Search by client, submitter, or profile name…"
          className="w-64 rounded border border-[var(--line)] bg-transparent px-2.5 py-1.5 text-xs"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilterAndReset(e.target.value as UpworkProposalStatus | "")}
          className="rounded border border-[var(--line)] bg-transparent px-2.5 py-1.5 text-xs"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} onClear={clearDateFilter} />
        <span className="ml-auto text-xs text-ink/50">{total} total</span>
      </div>

      {items === null ? (
        <p className="mt-4 text-xs text-ink/50">Loading…</p>
      ) : items.length === 0 ? (
        <p className="mt-4 text-xs text-ink/50">
          No {type === "BIDDING" ? "bidding" : "invite"} proposals {statusFilter || search ? "match this filter" : "logged yet"}.
        </p>
      ) : (
        <div className="mt-4">
          <DataTable columns={columns} rows={dateFilteredItems} rowKey={(r) => r.id} showSummary />
          <div className="mt-3 flex items-center justify-between text-xs text-ink/55">
            <span>
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded border border-[var(--line)] px-2.5 py-1 disabled:opacity-40"
              >
                ← Previous
              </button>
              <button
                onClick={() => setPage((p) => (p * PAGE_SIZE < total ? p + 1 : p))}
                disabled={page * PAGE_SIZE >= total}
                className="rounded border border-[var(--line)] px-2.5 py-1 disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      )}

      {followUpTarget && (
        <FollowUpRecipientsModal
          proposal={followUpTarget}
          onClose={() => setFollowUpTarget(null)}
          onSaved={(updated) => {
            setItems((prev) => prev?.map((p) => (p.id === updated.id ? { ...p, notifyUserIds: updated.notifyUserIds } : p)) ?? null);
            setFollowUpTarget(null);
          }}
        />
      )}

      {detailTarget && (
        <ProposalDetailModal
          proposal={detailTarget}
          type={type}
          picklists={picklists}
          canEditEarnings={canEditEarnings}
          onEditEarnings={(p) => { setDetailTarget(null); setEarningsTarget(p); }}
          onClose={() => setDetailTarget(null)}
          onSaved={(updated) => {
            setItems((prev) => prev?.map((p) => (p.id === updated.id ? updated : p)) ?? null);
            setDetailTarget(null);
            setNotice("Proposal updated.");
          }}
        />
      )}

      {earningsTarget && (
        <EarningsModal
          proposal={earningsTarget}
          onClose={() => setEarningsTarget(null)}
          onSaved={(updated) => {
            setItems((prev) => prev?.map((p) => (p.id === updated.id ? updated : p)) ?? null);
            setEarningsTarget(null);
            setNotice("Earnings saved.");
          }}
        />
      )}
    </section>
  );
}

/**
 * Full read/write view of one proposal row (Part: Upwork proposal search,
 * 2026-10-06, explicit user request — "open in a modal so that we can see
 * and update anything in it"). Unlike the inline table columns, which only
 * ever expose a handful of post-submission fields, this reaches every field
 * the original form collected too — a wrong profile, job link, or submitter
 * picked at submission time shouldn't require deleting and re-logging the
 * row.
 */
function ProposalDetailModal({
  proposal,
  type,
  picklists,
  canEditEarnings,
  onEditEarnings,
  onClose,
  onSaved,
}: {
  proposal: UpworkProposal;
  type: UpworkProposalType;
  picklists?: UpworkPicklists;
  canEditEarnings: boolean;
  onEditEarnings: (proposal: UpworkProposal) => void;
  onClose: () => void;
  onSaved: (updated: UpworkProposal) => void;
}) {
  const [profileName, setProfileName] = useState(proposal.profileName);
  const [jobCategory, setJobCategory] = useState(proposal.jobCategory);
  const [jobLink, setJobLink] = useState(proposal.jobLink);
  const [coverLetter, setCoverLetter] = useState(proposal.coverLetter);
  const [submittedBy, setSubmittedBy] = useState(proposal.submittedBy);
  const [connects, setConnects] = useState(proposal.connects != null ? String(proposal.connects) : "");
  const [accountType, setAccountType] = useState<UpworkAccountType>(proposal.accountType ?? "LIVE");
  const [projectHours, setProjectHours] = useState(proposal.projectHours != null ? String(proposal.projectHours) : "");
  const [pricingType, setPricingType] = useState<UpworkProjectPricingType>(proposal.pricingType);
  const [clientName, setClientName] = useState(proposal.clientName ?? "");
  const [status, setStatus] = useState<UpworkProposalStatus>(proposal.status);
  const [closedBy, setClosedBy] = useState(proposal.closedBy ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A proposal's current value might not be in the live picklist anymore
  // (removed by an admin after submission) — union it in so the select
  // doesn't silently blank out a real value.
  const profileOptions = Array.from(new Set([proposal.profileName, ...(picklists?.profiles ?? [])]));
  const categoryOptions = Array.from(new Set([proposal.jobCategory, ...(picklists?.categories ?? [])]));
  const submitterOptions = Array.from(new Set([proposal.submittedBy, ...(picklists?.submitters ?? [])]));

  async function save() {
    if (type === "INVITE" && !clientName.trim()) {
      setError("Client name is required for invites.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = (await api.updateUpworkProposal(proposal.id, {
        profileName,
        jobCategory,
        jobLink,
        coverLetter,
        submittedBy,
        projectHours: projectHours ? Number(projectHours) : null,
        pricingType,
        clientName: clientName.trim() || null,
        status,
        ...(type === "BIDDING"
          ? { connects: connects ? Number(connects) : null, accountType, closedBy: closedBy || null }
          : {}),
      })) as UpworkProposal;
      onSaved(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={`${type === "BIDDING" ? "Bidding" : "Invite"} proposal details`}
      contentClassName="w-full max-w-lg"
    >
      <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-1 text-sm">
        <label className="block">
          <span className={labelClass}>Client name{type === "INVITE" ? " (required)" : ""}</span>
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Upwork profile / ID name</span>
          <select value={profileName} onChange={(e) => setProfileName(e.target.value)} className={inputClass}>
            {profileOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Job category</span>
          <select value={jobCategory} onChange={(e) => setJobCategory(e.target.value)} className={inputClass}>
            {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Job link</span>
          <input value={jobLink} onChange={(e) => setJobLink(e.target.value)} type="url" className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>{type === "BIDDING" ? "Proposal / cover letter" : "Cover letter for invite"}</span>
          <textarea value={coverLetter} onChange={(e) => setCoverLetter(e.target.value)} rows={5} className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>{type === "INVITE" ? "Accepted by" : "Submitted by"}</span>
          <select value={submittedBy} onChange={(e) => setSubmittedBy(e.target.value)} className={inputClass}>
            {submitterOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {type === "BIDDING" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={labelClass}>Connects spent</span>
              <input value={connects} onChange={(e) => setConnects(e.target.value)} type="number" min={0} className={inputClass} />
            </label>
            <label className="block">
              <span className={labelClass}>Bidding type</span>
              <select value={accountType} onChange={(e) => setAccountType(e.target.value as UpworkAccountType)} className={inputClass}>
                <option value="LIVE">Live</option>
                <option value="TRAINING">Training</option>
              </select>
            </label>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>Pricing</span>
            <select value={pricingType} onChange={(e) => setPricingType(e.target.value as UpworkProjectPricingType)} className={inputClass}>
              <option value="HOURLY">Hourly</option>
              <option value="FIXED">Fixed-price</option>
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as UpworkProposalStatus)} className={inputClass}>
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        </div>
        {pricingType === "HOURLY" && (
          <label className="block">
            <span className={labelClass}>Project hours</span>
            <input value={projectHours} onChange={(e) => setProjectHours(e.target.value)} type="number" min={0} step="0.5" className={inputClass} />
          </label>
        )}
        {type === "BIDDING" && (
          <label className="block">
            <span className={labelClass}>Closed by</span>
            <input value={closedBy} onChange={(e) => setClosedBy(e.target.value)} className={inputClass} />
          </label>
        )}
        {proposal.status === "WON" && (
          <div className="rounded-lg border border-[var(--line)] p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className={labelClass + " mb-0"}>Earnings</span>
              {canEditEarnings && (
                <button onClick={() => onEditEarnings(proposal)} className="text-xs text-accent hover:underline">
                  {proposal.clientEarnings !== null ? "Edit earnings" : "+ Add earnings"}
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div><span className="text-ink/50">Client earnings</span><br />{formatMoney(proposal.clientEarnings)}</div>
              <div><span className="text-ink/50">Service fee</span><br />{formatMoney(proposal.serviceFeeAmount)}</div>
              <div><span className="text-ink/50">Net earnings</span><br />{formatMoney(proposal.netEarnings)}</div>
            </div>
          </div>
        )}
        {error && <span className="text-xs text-bad">{error}</span>}
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button size="sm" variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={saving} loading={saving} onClick={save}>Save changes</Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Who gets nudged to follow up on one accepted invite, and whether that
 * nudge should fire immediately or wait for UpworkFollowUpReminderWorker's
 * own 2-day cadence (Part: Upwork follow-up reminders, 2026-09-30 —
 * "select the person to notify right now or later"). Recipients are saved
 * wholesale, same pattern as UpworkPicklistManager.
 */
function FollowUpRecipientsModal({
  proposal,
  onClose,
  onSaved,
}: {
  proposal: UpworkProposal;
  onClose: () => void;
  onSaved: (updated: { id: string; notifyUserIds: string[] }) => void;
}) {
  const { data: users } = useQuery({ queryKey: ["org-users-for-notify"], queryFn: () => api.getUsers() as Promise<OrgUser[]> });
  const [selected, setSelected] = useState<string[]>(proposal.notifyUserIds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(userId: string) {
    setSelected((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  }

  async function save(notifyNow: boolean) {
    setSaving(true);
    setError(null);
    try {
      const updated = (await api.setUpworkNotifyRecipients(proposal.id, { userIds: selected, notifyNow })) as {
        id: string;
        notifyUserIds: string[];
      };
      onSaved(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onOpenChange={(open) => !open && onClose()} title="Follow-up reminder" contentClassName="w-full max-w-sm">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-xs text-ink/55">
          Choose who should be reminded to follow up on {proposal.clientName ?? "this client"}
          {"'"}s invite if it stays Accepted with no status change. They{"'"}ll be nudged every 2 days automatically —
          or notify them right now instead.
        </p>
        <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto rounded-lg border border-[var(--line)] p-2">
          {(users ?? []).filter((u) => u.active).map((u) => (
            <label key={u.id} className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} />
              {u.name}
            </label>
          ))}
          {users && users.filter((u) => u.active).length === 0 && <p className="text-xs text-ink/45">No active team members.</p>}
        </div>
        {error && <span className="text-xs text-error">{error}</span>}
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={saving || selected.length === 0} loading={saving} onClick={() => save(true)}>
            Save &amp; notify now
          </Button>
          <Button size="sm" variant="secondary" disabled={saving} loading={saving} onClick={() => save(false)}>
            Save for later
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Enter/edit a won proposal's earnings (Part: Upwork earnings tracking,
 * 2026-10-28). Opens three ways: auto-prompted the moment a row is first
 * marked Won (see UpworkProposalsSection.updateField), the "Client
 * Earnings" table cell for an already-Won row, or ProposalDetailModal's own
 * "Edit earnings" button — all three just pass a proposal in here.
 *
 * serviceFeeAmount/netEarnings are never sent — the backend
 * (UpworkService.resolveEarnings) always derives them from the three
 * fields below, so this form can't drift from that math. The live preview
 * here mirrors that same formula purely for immediate feedback; the saved
 * figures always come back from the server's own computation, not this
 * preview.
 */
function EarningsModal({
  proposal,
  onClose,
  onSaved,
}: {
  proposal: UpworkProposal;
  onClose: () => void;
  onSaved: (updated: UpworkProposal) => void;
}) {
  const [clientEarnings, setClientEarnings] = useState(proposal.clientEarnings ?? "");
  const [serviceFeeType, setServiceFeeType] = useState<UpworkServiceFeeType>(proposal.serviceFeeType ?? "PERCENT");
  const [serviceFeeValue, setServiceFeeValue] = useState(proposal.serviceFeeValue ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gross = clientEarnings === "" ? null : Number(clientEarnings);
  const feeValue = serviceFeeValue === "" ? null : Number(serviceFeeValue);
  // Preview-only mirror of UpworkService.resolveEarnings — the fee is
  // "unknown" (not zero) until a value is actually entered, same as the
  // backend's own rule.
  const feeAmount = gross !== null && feeValue !== null ? (serviceFeeType === "PERCENT" ? Math.round(gross * (feeValue / 100) * 100) / 100 : feeValue) : null;
  const net = gross !== null && feeAmount !== null ? Math.round((gross - feeAmount) * 100) / 100 : null;

  async function save() {
    if (gross === null || gross < 0) {
      setError("Enter the client's earnings amount.");
      return;
    }
    if (serviceFeeType === "PERCENT" && feeValue !== null && feeValue > 100) {
      setError("A percentage service fee can't be over 100%.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = (await api.updateUpworkProposal(proposal.id, {
        clientEarnings: gross,
        ...(feeValue !== null ? { serviceFeeType, serviceFeeValue: feeValue } : {}),
      })) as UpworkProposal;
      onSaved(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onOpenChange={(open) => !open && onClose()} title="Enter earnings" contentClassName="w-full max-w-sm">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-xs text-ink/55">
          {proposal.clientName ?? "This client"}{"'"}s contract value and Upwork{"'"}s service fee — net earnings is
          calculated for you.
        </p>
        <label className="block">
          <span className={labelClass}>Client earnings ($)</span>
          <input
            value={clientEarnings}
            onChange={(e) => setClientEarnings(e.target.value)}
            type="number"
            min={0}
            step="0.01"
            autoFocus
            className={inputClass}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={labelClass}>Upwork service fee</span>
            <select value={serviceFeeType} onChange={(e) => setServiceFeeType(e.target.value as UpworkServiceFeeType)} className={inputClass}>
              <option value="PERCENT">Percent (%)</option>
              <option value="FIXED">Fixed amount ($)</option>
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>{serviceFeeType === "PERCENT" ? "Fee %" : "Fee $"}</span>
            <input
              value={serviceFeeValue}
              onChange={(e) => setServiceFeeValue(e.target.value)}
              type="number"
              min={0}
              max={serviceFeeType === "PERCENT" ? 100 : undefined}
              step="0.01"
              placeholder={serviceFeeType === "PERCENT" ? "e.g. 10" : "e.g. 100"}
              className={inputClass}
            />
          </label>
        </div>
        <div className="rounded-lg border border-[var(--line)] p-3 text-xs">
          <div className="flex justify-between py-0.5"><span className="text-ink/55">Service fee amount</span><span>{feeAmount !== null ? formatMoney(feeAmount) : "— (enter a fee to calculate)"}</span></div>
          <div className="flex justify-between py-0.5 font-medium"><span className="text-ink/70">Net earnings</span><span>{net !== null ? formatMoney(net) : "—"}</span></div>
        </div>
        {error && <span className="text-xs text-bad">{error}</span>}
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button size="sm" variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={saving || gross === null} loading={saving} onClick={save}>Save earnings</Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Monthly earnings summary for this page's own type (Part: Upwork earnings
 * tracking, 2026-10-28, spec section 3/4/5) — month+year picker over
 * UpworkService.getEarningsSummary, which already scopes to WON rows
 * bucketed by `onboardedAt` and excludes incomplete earnings from the
 * totals server-side; this component just renders whichever of
 * `bidding`/`invite` matches its own `type` prop, so Bidding's and
 * Invite's panels never bleed into each other even though one API call
 * returns both (plus `combined`, unused here — there's no single overall
 * Upwork dashboard page yet to put it on).
 */
function EarningsSummaryPanel({ type }: { type: UpworkProposalType }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const { data, isLoading } = useQuery({
    queryKey: ["upwork-earnings-summary", month, year],
    queryFn: () =>
      api.getUpworkEarningsSummary({ month: String(month), year: String(year) }) as Promise<{
        bidding: { clientsWon: number; totalClientEarnings: number; totalServiceFees: number; totalNetEarnings: number; missingEarningsCount: number };
        invite: { clientsWon: number; totalClientEarnings: number; totalServiceFees: number; totalNetEarnings: number; missingEarningsCount: number };
      }>,
  });

  const summary = data?.[type === "BIDDING" ? "bidding" : "invite"];
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const years = Array.from({ length: 4 }, (_, i) => now.getFullYear() - i);

  return (
    <div className="mt-4 rounded-lg border border-[var(--line)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink/55">Monthly earnings</h3>
        <div className="flex items-center gap-2">
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="rounded border border-[var(--line)] bg-transparent px-2 py-1 text-xs">
            {monthNames.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded border border-[var(--line)] bg-transparent px-2 py-1 text-xs">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {isLoading || !summary ? (
        <p className="text-xs text-ink/50">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryTile label="Clients Won" value={String(summary.clientsWon)} />
            <SummaryTile label="Total Client Earnings" value={formatMoney(summary.totalClientEarnings)} />
            <SummaryTile label="Total Upwork Service Fees" value={formatMoney(summary.totalServiceFees)} />
            <SummaryTile label="Total Net Earnings" value={formatMoney(summary.totalNetEarnings)} tone="good" />
          </div>
          {summary.missingEarningsCount > 0 && (
            <p className="mt-2 text-[11px] text-gold">
              {summary.missingEarningsCount} won {summary.missingEarningsCount === 1 ? "record" : "records"} this month still need{summary.missingEarningsCount === 1 ? "s" : ""} earnings entered — excluded from the totals above.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone?: "good" }) {
  return (
    <div className="rounded-md bg-ink/[0.03] p-2.5">
      <div className="text-[11px] text-ink/50">{label}</div>
      <div className={`mt-0.5 text-base font-semibold ${tone === "good" ? "text-good" : ""}`}>{value}</div>
    </div>
  );
}
