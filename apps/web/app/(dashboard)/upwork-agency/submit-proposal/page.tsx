"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard } from "../../../../components/chart-kit";
import { UpworkAgencyConnectionGate, UpworkConnectionStatus } from "../../../../components/upwork-agency-connection-gate";

/**
 * Submit Proposals to Jobs (spec Module Q) — the highest-risk write in
 * the whole Upwork integration: this submits a real bid and spends real
 * Connects. Part: Upwork API integration — enterprise UI shell,
 * 2026-10-23.
 *
 * Requires a `selectedContractorId` + `oDeskUserID` neither this app nor
 * the marketplace search surfaces directly (confirmed via introspection
 * — see UpworkGraphQLClient.createJobProposal's own docblock) — these
 * must come from the job posting's own contractor-selection data on
 * Upwork's side, so this form expects them to be known/entered manually
 * rather than auto-filled from a job search result.
 */
export default function SubmitProposalPage() {
  const statusQuery = useQuery({ queryKey: ["upwork-api-status"], queryFn: () => api.getUpworkApiStatus() as Promise<UpworkConnectionStatus> });
  const connected = Boolean(statusQuery.data?.connected);

  const [form, setForm] = useState({
    selectedContractorId: "",
    oDeskUserID: "",
    jobReference: "",
    chargedAmount: "",
    coverLetter: "",
  });
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Submit Proposal" />;

  const canReview = form.selectedContractorId && form.oDeskUserID && form.jobReference && form.chargedAmount && form.coverLetter;

  async function confirmSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.submitUpworkApiProposal({
        confirmed: true,
        selectedContractorId: form.selectedContractorId,
        oDeskUserID: form.oDeskUserID,
        jobReference: form.jobReference,
        chargedAmount: parseFloat(form.chargedAmount),
        coverLetter: form.coverLetter,
      });
      setResult(`Submitted — status: ${res.status ?? "unknown"}${res.newProposalId ? `, proposal ID: ${res.newProposalId}` : ""}${res.error ? `, error: ${res.error}` : ""}`);
      setReviewing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold tracking-tight">Submit Proposal</h1>
      <p className="text-xs text-ink/50">Submits a real bid to a real Upwork job and spends real Connects. Final confirmation is required before anything is sent.</p>

      {error && <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">{error}</div>}
      {result && <div className="rounded-lg border border-[rgb(var(--good-rgb)/0.4)] bg-[rgb(var(--good-rgb)/0.06)] px-3 py-2 text-sm text-good">{result}</div>}

      <SectionCard title="Proposal details">
        <div className="flex flex-col gap-3 max-w-xl">
          <label className="text-xs font-medium text-ink/70">
            Selected Contractor ID (from the job&apos;s contractor-selection data)
            <input className="mt-1 h-9 w-full rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm" value={form.selectedContractorId} onChange={(e) => setForm({ ...form, selectedContractorId: e.target.value })} />
          </label>
          <label className="text-xs font-medium text-ink/70">
            Freelancer&apos;s oDeskUserID
            <input className="mt-1 h-9 w-full rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm" value={form.oDeskUserID} onChange={(e) => setForm({ ...form, oDeskUserID: e.target.value })} />
          </label>
          <label className="text-xs font-medium text-ink/70">
            Job reference
            <input className="mt-1 h-9 w-full rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm" value={form.jobReference} onChange={(e) => setForm({ ...form, jobReference: e.target.value })} />
          </label>
          <label className="text-xs font-medium text-ink/70">
            Charged amount (USD)
            <input type="number" className="mt-1 h-9 w-full rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm" value={form.chargedAmount} onChange={(e) => setForm({ ...form, chargedAmount: e.target.value })} />
          </label>
          <label className="text-xs font-medium text-ink/70">
            Cover letter
            <textarea className="mt-1 h-28 w-full rounded-md border border-[var(--line)] bg-transparent px-2.5 py-2 text-sm" value={form.coverLetter} onChange={(e) => setForm({ ...form, coverLetter: e.target.value })} />
          </label>

          {!reviewing ? (
            <button
              type="button"
              disabled={!canReview}
              onClick={() => setReviewing(true)}
              className="mt-2 h-9 w-fit rounded-md bg-accent px-4 text-sm text-white disabled:opacity-50"
            >
              Review before submitting
            </button>
          ) : (
            <div className="mt-2 flex flex-col gap-2 rounded-lg border border-[var(--line)] bg-ink/[0.03] p-3">
              <p className="text-sm font-medium text-ink">Final review — this will submit a real bid and spend real Connects.</p>
              <p className="text-xs text-ink/55">Job {form.jobReference} · ${form.chargedAmount} · contractor {form.selectedContractorId}</p>
              <div className="flex gap-2">
                <button type="button" disabled={submitting} onClick={confirmSubmit} className="h-9 rounded-md bg-bad px-4 text-sm text-white disabled:opacity-50">
                  {submitting ? "Submitting…" : "Confirm & Submit"}
                </button>
                <button type="button" onClick={() => setReviewing(false)} className="h-9 rounded-md border border-[var(--line)] px-4 text-sm text-ink/70">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
