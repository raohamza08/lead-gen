"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getCurrentUser } from "../lib/api-client";
import { DataTable, SectionCard, StatTile, type TableColumn } from "./chart-kit";
import { Modal } from "./ui/modal";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type UpworkRequestStatus = "DRAFT" | "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "COMPLETED";

interface RequestItem {
  id: string;
  profileName: string;
  requestedHours: number;
}

interface UpworkRequest {
  id: string;
  requestDate: string;
  status: UpworkRequestStatus;
  notes: string | null;
  totalRequestedHours: number;
  reviewNotes: string | null;
  reviewedAt: string | null;
  createdAt: string;
  items: RequestItem[];
  projectManager: { id: string; name: string };
  reviewedByUser: { id: string; name: string } | null;
}

interface WeeklyTarget {
  requestedHours: number;
  biddingHoursOnboarded: number;
  inviteHoursOnboarded: number;
  totalHoursOnboarded: number;
  remainingHours: number;
}

interface AchievementRow {
  profileName: string;
  requested: number;
  bidding: number;
  invites: number;
  totalAchieved: number;
  remaining: number;
}

interface AchievementReport {
  rows: AchievementRow[];
  totals: { requested: number; bidding: number; invites: number; totalAchieved: number; remaining: number };
}

const STATUS_LABEL: Record<UpworkRequestStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  COMPLETED: "Completed",
};

const STATUS_TONE: Record<UpworkRequestStatus, string> = {
  DRAFT: "text-ink/50",
  SUBMITTED: "text-ink/60",
  UNDER_REVIEW: "text-gold",
  APPROVED: "text-good",
  REJECTED: "text-bad",
  COMPLETED: "text-accent",
};

const inputClass = "w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm";
const labelClass = "mb-1 block text-xs text-ink/60";

type RangeName = "THIS_WEEK" | "LAST_WEEK" | "CUSTOM";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Project Manager hour requests, inside the Upwork Proposals module (Part:
 * Upwork Requests, 2026-10-01). A Project Manager creates/submits/edits their
 * own requests here; an Admin or Business Developer reviews, approves, or
 * rejects everyone's. Both roles share this one component -- which sections
 * render (the creation form, the review queue) depends entirely on the
 * current user's role, same pattern UpworkProposalsSection already uses for
 * its admin-only picklist manager and follow-up controls.
 */
export function UpworkRequestsSection() {
  const user = getCurrentUser();
  const role = user?.role;
  const isPM = role === "PROJECT_MANAGER";
  const isBD = role === "BUSINESS_DEVELOPER";
  const isReviewer = role === "ADMIN" || isBD;
  const canCreate = isPM || role === "ADMIN";
  const queryClient = useQueryClient();

  const [range, setRange] = useState<RangeName>("THIS_WEEK");
  const [customFrom, setCustomFrom] = useState(todayIso());
  const [customTo, setCustomTo] = useState(todayIso());
  const [pmFilter, setPmFilter] = useState<string>(""); // admin-only filter
  const [bdFilter, setBdFilter] = useState<string>(""); // admin-only filter
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewTarget, setReviewTarget] = useState<UpworkRequest | null>(null);

  // The weekly target belongs to whichever Business Developer approves a
  // request, not the requesting Project Manager (explicit user decision —
  // "the target is for the persons who are mentioned as bd"). A PM/BD's own
  // scope is enforced server-side regardless of what's sent here; only an
  // Admin's pmFilter/bdFilter selections actually do anything.
  const rangeParams: Record<string, string> = range === "CUSTOM" ? { range, from: customFrom, to: customTo } : { range };
  const scopedParams = {
    ...rangeParams,
    ...(role === "ADMIN" && pmFilter ? { projectManagerId: pmFilter } : {}),
    ...(role === "ADMIN" && bdFilter ? { businessDeveloperId: bdFilter } : {}),
  };

  const profilesQuery = useQuery({
    queryKey: ["upwork-request-profiles"],
    queryFn: () => api.getUpworkRequestProfiles() as Promise<string[]>,
    enabled: canCreate,
  });

  const requestsQuery = useQuery({
    queryKey: ["upwork-requests", isReviewer ? "all" : "mine"],
    queryFn: () => api.getUpworkRequests({ pageSize: "100" }) as Promise<{ items: UpworkRequest[]; total: number }>,
  });

  const targetQuery = useQuery({
    queryKey: ["upwork-weekly-target", scopedParams],
    queryFn: () => api.getUpworkWeeklyTarget(scopedParams) as Promise<WeeklyTarget>,
  });

  const achievementQuery = useQuery({
    queryKey: ["upwork-achievement", scopedParams],
    queryFn: () => api.getUpworkAchievement(scopedParams) as Promise<AchievementReport>,
  });

  const usersQuery = useQuery({
    queryKey: ["org-users-for-upwork-requests"],
    queryFn: () => api.getUsers() as Promise<{ id: string; name: string; role: string; active: boolean }[]>,
    enabled: isReviewer,
  });
  const projectManagers = (usersQuery.data ?? []).filter((u) => u.role === "PROJECT_MANAGER" && u.active);
  const businessDevelopers = (usersQuery.data ?? []).filter((u) => u.role === "BUSINESS_DEVELOPER" && u.active);

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["upwork-requests"] });
    queryClient.invalidateQueries({ queryKey: ["upwork-weekly-target"] });
    queryClient.invalidateQueries({ queryKey: ["upwork-achievement"] });
  }

  const submitMutation = useMutation({
    mutationFn: (id: string) => api.submitUpworkRequest(id),
    onSuccess: () => { setNotice("Request submitted for review."); invalidateAll(); },
    onError: (err) => setError((err as Error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteUpworkRequest(id),
    onSuccess: invalidateAll,
    onError: (err) => setError((err as Error).message),
  });

  const requests = requestsQuery.data?.items ?? [];
  const myRequests = isReviewer ? requests : requests.filter((r) => r.projectManager.id === user?.sub);
  const reviewQueue = requests.filter((r) => r.status === "SUBMITTED" || r.status === "UNDER_REVIEW");

  const columns: TableColumn<UpworkRequest>[] = [
    { key: "requestDate", header: "Date", render: (r) => new Date(r.requestDate).toLocaleDateString() },
    // Always shown, regardless of viewer role (explicit user request — "the
    // name of the person who is making request for hours should also be
    // mentioned with the request").
    { key: "pm", header: "Requested by", render: (r) => r.projectManager.name },
    {
      key: "items",
      header: "Profiles / Hours",
      render: (r) => (
        <div className="flex flex-col gap-0.5 text-xs">
          {r.items.map((i) => (
            <span key={i.id}>{i.profileName}: {i.requestedHours}h</span>
          ))}
        </div>
      ),
    },
    { key: "total", header: "Total Hours", numeric: true, render: (r) => r.totalRequestedHours },
    { key: "status", header: "Status", render: (r) => <span className={`text-xs font-medium ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span> },
    { key: "reviewer", header: "Reviewed by", render: (r) => r.reviewedByUser?.name ?? "—" },
    { key: "notes", header: "Notes", render: (r) => <span className="text-xs text-ink/60">{r.reviewNotes || r.notes || "—"}</span> },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <div className="flex items-center gap-2">
          {r.projectManager.id === user?.sub && r.status === "DRAFT" && (
            <>
              <button onClick={() => submitMutation.mutate(r.id)} className="text-xs text-accent hover:underline">Submit</button>
              <button onClick={() => { if (confirm("Delete this draft request?")) deleteMutation.mutate(r.id); }} className="text-xs text-bad hover:underline">Delete</button>
            </>
          )}
          {isReviewer && (r.status === "SUBMITTED" || r.status === "UNDER_REVIEW") && (
            <button onClick={() => setReviewTarget(r)} className="text-xs text-accent hover:underline">Review</button>
          )}
          {isReviewer && r.status === "APPROVED" && (
            <button onClick={() => setReviewTarget(r)} className="text-xs text-accent hover:underline">Mark complete</button>
          )}
        </div>
      ),
    },
  ];

  const target = targetQuery.data;

  return (
    <div className="flex flex-col gap-5">
      <section className="card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">{isBD ? "Your weekly target" : isPM ? "Your requests this week" : "Weekly target"}</h2>
            <p className="mt-0.5 text-xs text-ink/55">
              {isPM
                ? "What you requested, and what came in through Bidding/Invite for those profiles — the target itself belongs to whichever Business Developer approves it."
                : isBD
                  ? "Requests you've approved — what you're on the hook to deliver through Bidding/Invite, and what's come in so far."
                  : "Org-wide requested vs. onboarded hours for the selected period. Filter by Project Manager (who asked) or Business Developer (who owns the target)."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={range} onChange={(e) => setRange(e.target.value as RangeName)} className="rounded border border-[var(--line)] bg-transparent px-2.5 py-1.5 text-xs">
              <option value="THIS_WEEK">This week</option>
              <option value="LAST_WEEK">Last week</option>
              <option value="CUSTOM">Custom range</option>
            </select>
            {range === "CUSTOM" && (
              <>
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="rounded border border-[var(--line)] bg-transparent px-2 py-1.5 text-xs" />
                <span className="text-xs text-ink/40">to</span>
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="rounded border border-[var(--line)] bg-transparent px-2 py-1.5 text-xs" />
              </>
            )}
            {role === "ADMIN" && (
              <>
                <select value={pmFilter} onChange={(e) => setPmFilter(e.target.value)} className="rounded border border-[var(--line)] bg-transparent px-2.5 py-1.5 text-xs">
                  <option value="">All project managers</option>
                  {projectManagers.map((pm) => <option key={pm.id} value={pm.id}>{pm.name}</option>)}
                </select>
                <select value={bdFilter} onChange={(e) => setBdFilter(e.target.value)} className="rounded border border-[var(--line)] bg-transparent px-2.5 py-1.5 text-xs">
                  <option value="">All business developers</option>
                  {businessDevelopers.map((bd) => <option key={bd.id} value={bd.id}>{bd.name}</option>)}
                </select>
              </>
            )}
          </div>
        </div>

        {targetQuery.isLoading ? (
          <p className="text-xs text-ink/50">Loading…</p>
        ) : target ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatTile label="Requested Hours" value={target.requestedHours} />
            <StatTile label="Bidding Hours Onboarded" value={target.biddingHoursOnboarded} />
            <StatTile label="Invite Hours Onboarded" value={target.inviteHoursOnboarded} />
            <StatTile label="Total Hours Onboarded" value={target.totalHoursOnboarded} tone="good" />
            <StatTile label="Remaining Hours" value={target.remainingHours} tone={target.remainingHours > 0 ? "gold" : "good"} />
          </div>
        ) : null}
      </section>

      {error && <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">{error}</div>}
      {notice && <div className="rounded-lg border border-[rgb(var(--good-rgb)/0.4)] bg-[rgb(var(--good-rgb)/0.06)] px-3 py-2 text-sm text-good">{notice}</div>}

      {canCreate && (
        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">Requests</h2>
              <p className="mt-0.5 text-xs text-ink/55">Request a number of hours against one or more profiles/IDs for new work.</p>
            </div>
            <button onClick={() => setShowForm((v) => !v)} className="rounded-md border border-[var(--line)] px-3 py-1.5 text-xs hover:bg-ink/5">
              {showForm ? "Cancel" : "New request"}
            </button>
          </div>

          {showForm && (
            <RequestForm
              availableProfiles={profilesQuery.data ?? []}
              onCancel={() => setShowForm(false)}
              onSaved={(message) => { setShowForm(false); setNotice(message); setError(null); invalidateAll(); }}
              onError={setError}
            />
          )}

          {requestsQuery.isLoading ? (
            <p className="mt-4 text-xs text-ink/50">Loading…</p>
          ) : myRequests.length === 0 ? (
            <p className="mt-4 text-xs text-ink/50">No requests yet.</p>
          ) : (
            <div className="mt-4">
              <DataTable columns={columns} rows={isReviewer ? myRequests : myRequests} rowKey={(r) => r.id} />
            </div>
          )}
        </section>
      )}

      {isReviewer && (
        <SectionCard title="Requests pending review" subtitle="Approve or reject Project Manager requests — approved requests automatically count toward the weekly target.">
          {reviewQueue.length === 0 ? (
            <p className="text-xs text-ink/50">Nothing pending review.</p>
          ) : (
            <DataTable columns={columns} rows={reviewQueue} rowKey={(r) => r.id} />
          )}
        </SectionCard>
      )}

      <SectionCard title="Request vs achievement" subtitle="Requested hours per profile vs. what Bidding/Invite actually produced, for the selected period." expandable>
        {achievementQuery.isLoading ? (
          <p className="text-xs text-ink/50">Loading…</p>
        ) : !achievementQuery.data || achievementQuery.data.rows.length === 0 ? (
          <p className="text-xs text-ink/50">No approved requests in this period.</p>
        ) : (
          <DataTable
            rowKey={(r) => r.profileName}
            rows={[...achievementQuery.data.rows, { profileName: "Total", ...achievementQuery.data.totals }]}
            columns={[
              { key: "profileName", header: "Profile/ID", render: (r) => r.profileName },
              { key: "requested", header: "Requested", numeric: true, render: (r) => r.requested },
              { key: "bidding", header: "Bidding", numeric: true, render: (r) => r.bidding },
              { key: "invites", header: "Invites", numeric: true, render: (r) => r.invites },
              { key: "totalAchieved", header: "Total Achieved", numeric: true, render: (r) => r.totalAchieved },
              { key: "remaining", header: "Remaining", numeric: true, render: (r) => r.remaining },
            ]}
          />
        )}
      </SectionCard>

      {reviewTarget && (
        <ReviewModal
          request={reviewTarget}
          onClose={() => setReviewTarget(null)}
          onSaved={(message) => { setReviewTarget(null); setNotice(message); setError(null); invalidateAll(); }}
          onError={setError}
        />
      )}
    </div>
  );
}

function RequestForm({
  availableProfiles,
  onCancel,
  onSaved,
  onError,
}: {
  availableProfiles: string[];
  onCancel: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [requestDate, setRequestDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<{ profileName: string; requestedHours: string }[]>([{ profileName: "", requestedHours: "" }]);
  const [submitting, setSubmitting] = useState<"draft" | "submit" | null>(null);

  const total = rows.reduce((sum, r) => sum + (Number(r.requestedHours) || 0), 0);
  const validRows = rows.filter((r) => r.profileName && Number(r.requestedHours) > 0);

  function addRow() {
    setRows((r) => [...r, { profileName: "", requestedHours: "" }]);
  }
  function removeRow(index: number) {
    setRows((r) => r.filter((_, i) => i !== index));
  }
  function updateRow(index: number, patch: Partial<{ profileName: string; requestedHours: string }>) {
    setRows((r) => r.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function save(status: "DRAFT" | "SUBMITTED") {
    if (validRows.length === 0) {
      onError("Add at least one profile with hours greater than zero.");
      return;
    }
    setSubmitting(status === "DRAFT" ? "draft" : "submit");
    try {
      await api.createUpworkRequest({
        requestDate,
        notes: notes.trim() || undefined,
        status,
        items: validRows.map((r) => ({ profileName: r.profileName, requestedHours: Number(r.requestedHours) })),
      });
      onSaved(status === "DRAFT" ? "Request saved as draft." : "Request submitted for review.");
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="mb-5 mt-4 flex flex-col gap-3 rounded-lg border border-[var(--line)] p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>Request date</span>
          <input type="date" value={requestDate} onChange={(e) => setRequestDate(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Notes / comments (optional)</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
        </label>
      </div>

      <div>
        <span className={labelClass}>IDs/Profiles and requested hours</span>
        <div className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <select value={row.profileName} onChange={(e) => updateRow(i, { profileName: e.target.value })} className={`${inputClass} flex-1`}>
                <option value="" disabled>Select a profile…</option>
                {availableProfiles.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <input
                value={row.requestedHours}
                onChange={(e) => updateRow(i, { requestedHours: e.target.value })}
                type="number"
                min={0}
                step="0.5"
                placeholder="Hours"
                className="w-28 rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
              />
              {rows.length > 1 && (
                <button type="button" onClick={() => removeRow(i)} className="text-xs text-bad hover:underline">Remove</button>
              )}
            </div>
          ))}
        </div>
        {availableProfiles.length === 0 && (
          <p className="mt-1 text-[11px] text-gold">No profiles available to request against — ask an admin to grant access or add profiles to the Upwork picklist.</p>
        )}
        <button type="button" onClick={addRow} className="mt-2 text-xs text-accent hover:underline">+ Add another profile</button>
      </div>

      <div className="flex items-center justify-between border-t border-[var(--line)] pt-3">
        <span className="text-sm font-medium">Total requested hours: {total}</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={submitting !== null} loading={submitting === "draft"} onClick={() => save("DRAFT")}>
            Save as draft
          </Button>
          <Button size="sm" disabled={submitting !== null} loading={submitting === "submit"} onClick={() => save("SUBMITTED")}>
            Submit request
          </Button>
          <Button variant="secondary" size="sm" disabled={submitting !== null} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

function ReviewModal({
  request,
  onClose,
  onSaved,
  onError,
}: {
  request: UpworkRequest;
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [reviewNotes, setReviewNotes] = useState(request.reviewNotes ?? "");
  const [saving, setSaving] = useState<string | null>(null);

  async function act(status: "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "COMPLETED") {
    setSaving(status);
    try {
      await api.reviewUpworkRequest(request.id, { status, reviewNotes: reviewNotes.trim() || undefined });
      onSaved(`Request marked ${STATUS_LABEL[status as UpworkRequestStatus].toLowerCase()}.`);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(null);
    }
  }

  return (
    <Modal open onOpenChange={(open) => !open && onClose()} title={`Review request — ${request.projectManager.name}`} contentClassName="w-full max-w-md">
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-col gap-1 rounded-lg border border-[var(--line)] p-3 text-xs">
          {request.items.map((i) => (
            <span key={i.id}>{i.profileName}: {i.requestedHours}h</span>
          ))}
          <span className="mt-1 font-medium">Total: {request.totalRequestedHours}h</span>
          {request.notes && <span className="mt-1 text-ink/55">Notes: {request.notes}</span>}
        </div>

        <label className="block">
          <span className={labelClass}>Review notes (optional)</span>
          <Input value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} placeholder="Reason for approval/rejection…" />
        </label>

        <div className="flex flex-wrap gap-2">
          {request.status === "SUBMITTED" && (
            <Button size="sm" variant="secondary" disabled={saving !== null} loading={saving === "UNDER_REVIEW"} onClick={() => act("UNDER_REVIEW")}>
              Mark under review
            </Button>
          )}
          {(request.status === "SUBMITTED" || request.status === "UNDER_REVIEW") && (
            <>
              <Button size="sm" disabled={saving !== null} loading={saving === "APPROVED"} onClick={() => act("APPROVED")}>
                Approve
              </Button>
              <Button size="sm" variant="secondary" disabled={saving !== null} loading={saving === "REJECTED"} onClick={() => act("REJECTED")}>
                Reject
              </Button>
            </>
          )}
          {request.status === "APPROVED" && (
            <Button size="sm" disabled={saving !== null} loading={saving === "COMPLETED"} onClick={() => act("COMPLETED")}>
              Mark completed
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
