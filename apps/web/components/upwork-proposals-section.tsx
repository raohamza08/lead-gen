"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, getCurrentUser } from "../lib/api-client";
import { DataTable, type TableColumn } from "./chart-kit";
import { UpworkPicklistManager } from "./upwork-picklist-manager";
import { Modal } from "./ui/modal";
import { Button } from "./ui/button";

export type UpworkProposalType = "BIDDING" | "INVITE";
type UpworkProposalStatus = "SUBMITTED" | "VIEWED" | "ACCEPTED" | "IN_DISCUSSION" | "FOLLOW_UP_1" | "FOLLOW_UP_2" | "WON" | "LOST";
type UpworkAccountType = "TRAINING" | "LIVE";

interface UpworkProposal {
  id: string;
  type: UpworkProposalType;
  profileName: string;
  jobCategory: string;
  jobLink: string;
  coverLetter: string;
  connects: number | null;
  accountType: UpworkAccountType | null;
  submittedBy: string;
  clickupTaskId: string | null;
  clientName: string | null;
  status: UpworkProposalStatus;
  closedBy: string | null;
  createdAt: string;
  acceptedAt: string | null;
  notifyUserIds: string[];
}

interface OrgUser {
  id: string;
  name: string;
  active: boolean;
}

const STATUS_OPTIONS: { value: UpworkProposalStatus; label: string }[] = [
  { value: "SUBMITTED", label: "Submitted" },
  { value: "VIEWED", label: "Viewed" },
  { value: "ACCEPTED", label: "Accepted" },
  { value: "IN_DISCUSSION", label: "In discussion" },
  { value: "FOLLOW_UP_1", label: "1st follow-up done" },
  { value: "FOLLOW_UP_2", label: "2nd follow-up done" },
  { value: "WON", label: "Client won" },
  { value: "LOST", label: "Lost" },
];

const STATUS_TONE: Record<UpworkProposalStatus, string> = {
  SUBMITTED: "text-ink/60",
  VIEWED: "text-ink/60",
  ACCEPTED: "text-gold",
  IN_DISCUSSION: "text-gold",
  FOLLOW_UP_1: "text-gold",
  FOLLOW_UP_2: "text-gold",
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

/**
 * Replaces the team's daily Upwork Proposals Google Form + Sheet (Part:
 * Upwork Proposals, 2026-09-29) — one form/list per proposal type (Bidding /
 * Invite), backed by the same UpworkProposal table server-side. Field names
 * mirror the original sheet's columns 1:1 so nothing has to be relearned.
 */
const PAGE_SIZE = 100;

export function UpworkProposalsSection({ type }: { type: UpworkProposalType }) {
  const isAdmin = getCurrentUser()?.role === "ADMIN";
  const [items, setItems] = useState<UpworkProposal[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<UpworkProposalStatus | "">("");
  const [searchSubmittedBy, setSearchSubmittedBy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [followUpTarget, setFollowUpTarget] = useState<UpworkProposal | null>(null);

  const [profileName, setProfileName] = useState("");
  const [jobCategory, setJobCategory] = useState("");
  const [jobLink, setJobLink] = useState("");
  const [coverLetter, setCoverLetter] = useState("");
  const [submittedBy, setSubmittedBy] = useState("");
  const [connects, setConnects] = useState("");
  const [accountType, setAccountType] = useState<UpworkAccountType>("LIVE");
  const [clientName, setClientName] = useState("");

  const { data: picklists } = useQuery({
    queryKey: ["upwork-picklists"],
    queryFn: () => api.getUpworkPicklists() as Promise<UpworkPicklists>,
  });

  function load() {
    api
      .getUpworkProposals({
        type,
        page: String(page),
        pageSize: String(PAGE_SIZE),
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(searchSubmittedBy.trim() ? { submittedBy: searchSubmittedBy.trim() } : {}),
      })
      .then((res) => {
        const r = res as { items: UpworkProposal[]; total: number };
        setItems(r.items);
        setTotal(r.total);
      })
      .catch((err) => setError((err as Error).message));
  }

  useEffect(load, [type, page, statusFilter, searchSubmittedBy]);

  // Changing a filter resets to page 1 in the same update, not a separate
  // effect — otherwise the page-1 reset and the filter change would fire as
  // two effects back to back, each triggering its own fetch.
  function setStatusFilterAndReset(v: UpworkProposalStatus | "") { setStatusFilter(v); setPage(1); }
  function setSearchAndReset(v: string) { setSearchSubmittedBy(v); setPage(1); }

  function resetForm() {
    setProfileName(""); setJobCategory(""); setJobLink(""); setCoverLetter("");
    setSubmittedBy(""); setConnects(""); setAccountType("LIVE"); setClientName("");
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
    { key: "createdAt", header: "Date", render: (r) => new Date(r.createdAt).toLocaleDateString() },
    { key: "profileName", header: "Profile", render: (r) => r.profileName },
    { key: "jobCategory", header: "Category", render: (r) => r.jobCategory },
    ...(type === "BIDDING"
      ? [{ key: "connects", header: "Connects", numeric: true, render: (r: UpworkProposal) => r.connects ?? "—" } as TableColumn<UpworkProposal>]
      : []),
    // Every invite is accepted by a real person before anything else happens
    // to it — for this type, "Submitted by" IS "who accepted the invite",
    // not a literal submission (Part: Upwork Invites, 2026-09-30), so the
    // column header reflects that instead of reusing Bidding's wording.
    { key: "submittedBy", header: type === "INVITE" ? "Accepted by" : "Submitted by", render: (r) => r.submittedBy },
    { key: "jobLink", header: "Job", render: (r) => (
      <a href={r.jobLink} target="_blank" rel="noreferrer" className="text-accent hover:underline">Open ↗</a>
    ) },
    { key: "status", header: "Status", render: (r) => (
      <select
        value={r.status}
        disabled={savingId === r.id}
        onChange={(e) => updateField(r.id, { status: e.target.value })}
        className={`rounded border border-[var(--line)] bg-transparent px-1.5 py-1 text-xs ${STATUS_TONE[r.status]}`}
      >
        {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    ) },
    { key: "clientName", header: "Client", render: (r) => (
      <input
        defaultValue={r.clientName ?? ""}
        placeholder="—"
        onBlur={(e) => { if (e.target.value !== (r.clientName ?? "")) updateField(r.id, { clientName: e.target.value || null }); }}
        className="w-28 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-[var(--line)] focus:border-[var(--line)]"
      />
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
          <p className="mt-0.5 text-xs text-ink/55">
            {type === "BIDDING"
              ? "Proposals submitted against a job you found and bid on — connects spent, training vs live account."
              : "Proposals submitted in response to a client invite — no connects involved."}
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md border border-[var(--line)] px-3 py-1.5 text-xs hover:bg-ink/5"
        >
          {showForm ? "Cancel" : "Log a proposal"}
        </button>
      </div>

      <UpworkPicklistManager />

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
            <span className={labelClass}>Submitted by</span>
            <select value={submittedBy} onChange={(e) => setSubmittedBy(e.target.value)} required className={inputClass}>
              <option value="" disabled>Select submitter…</option>
              {(picklists?.submitters ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {picklists && picklists.submitters.length === 0 && (
              <span className="mt-1 block text-[11px] text-gold">No names yet — an admin needs to add some above.</span>
            )}
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
            <span className={labelClass}>Client name (optional)</span>
            <input value={clientName} onChange={(e) => setClientName(e.target.value)} className={inputClass} />
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={submitting || !profileName || !jobCategory || !jobLink || !coverLetter || !submittedBy}
              className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Log proposal"}
            </button>
          </div>
        </form>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={searchSubmittedBy}
          onChange={(e) => setSearchAndReset(e.target.value)}
          placeholder="Filter by submitted by…"
          className="w-48 rounded border border-[var(--line)] bg-transparent px-2.5 py-1.5 text-xs"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilterAndReset(e.target.value as UpworkProposalStatus | "")}
          className="rounded border border-[var(--line)] bg-transparent px-2.5 py-1.5 text-xs"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span className="ml-auto text-xs text-ink/50">{total} total</span>
      </div>

      {items === null ? (
        <p className="mt-4 text-xs text-ink/50">Loading…</p>
      ) : items.length === 0 ? (
        <p className="mt-4 text-xs text-ink/50">
          No {type === "BIDDING" ? "bidding" : "invite"} proposals {statusFilter || searchSubmittedBy ? "match this filter" : "logged yet"}.
        </p>
      ) : (
        <div className="mt-4">
          <DataTable columns={columns} rows={items} rowKey={(r) => r.id} />
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
    </section>
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
