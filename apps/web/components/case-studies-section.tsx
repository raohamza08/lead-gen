"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api-client";
import { INDUSTRIES } from "@leadgen/types";

type CaseStudyStatus = "PENDING_REVIEW" | "READY" | "NEEDS_ATTENTION";

interface CaseStudy {
  id: string;
  title: string;
  summary: string;
  metrics: Record<string, unknown>;
  industry: string;
  submittedIndustry: string;
  status: CaseStudyStatus;
  reviewNotes: string | null;
  rawStory: string;
}

const STATUS_STYLE: Record<CaseStudyStatus, string> = {
  READY: "border-[rgb(var(--good-rgb)/0.4)] bg-[rgb(var(--good-rgb)/0.08)] text-good",
  NEEDS_ATTENTION: "border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.08)] text-bad",
  PENDING_REVIEW: "border-[var(--line)] bg-ink/5 text-ink/60",
};

const STATUS_LABEL: Record<CaseStudyStatus, string> = {
  READY: "Ready — used in Email 3",
  NEEDS_ATTENTION: "Needs attention",
  PENDING_REVIEW: "Reviewing…",
};

function industryLabel(value: string): string {
  return INDUSTRIES.find((i) => i.value === value)?.label ?? value;
}

/**
 * Real, company-specific proof for Email 3 ("Proof") of the 5-email
 * sequence — the only email allowed to name the sending company and cite a
 * concrete result (see shared/prompts/case_study_review.txt on the AI
 * workers side). Every submission is reviewed by the same AI worker before
 * it's usable: it tightens the wording, confirms or corrects the niche, and
 * refuses to invent a number the operator didn't state. Only a case study
 * the review marks READY is ever eligible for a real send — see
 * sequencer.service.ts's `status: READY` filter.
 */
export function CaseStudiesSection() {
  const [items, setItems] = useState<CaseStudy[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [rawStory, setRawStory] = useState("");
  const [submittedIndustry, setSubmittedIndustry] = useState(INDUSTRIES[0]?.value ?? "");

  function load() {
    api
      .getCaseStudies()
      .then((res) => setItems(res as CaseStudy[]))
      .catch((err) => setError((err as Error).message));
  }

  useEffect(load, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await api.createCaseStudy({ title: title.trim() || undefined, rawStory, submittedIndustry });
      setTitle("");
      setRawStory("");
      setShowForm(false);
      setNotice("Submitted and reviewed — see its status below.");
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function retry(id: string) {
    setRetryingId(id);
    setError(null);
    try {
      await api.retryCaseStudy(id);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRetryingId(null);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api.deleteCaseStudy(id);
      setItems((prev) => prev?.filter((cs) => cs.id !== id) ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="rounded-xl border border-[var(--line)] p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Case studies</h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md border border-[var(--line)] px-3 py-1.5 text-xs hover:bg-ink/5"
        >
          {showForm ? "Cancel" : "Add case study"}
        </button>
      </div>
      <p className="mb-4 text-xs text-ink/50">
        Real results from your own clients, used as proof in Email 3 of the outreach sequence. Write
        what actually happened — the AI reviews it, tightens the wording for email, and confirms
        which niche it fits. It never invents a number you didn&apos;t give it.
      </p>

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

      {showForm && (
        <form onSubmit={submit} className="mb-5 grid gap-3 rounded-lg border border-[var(--line)] p-4">
          <label className="block">
            <span className="mb-1 block text-xs text-ink/60">Title (optional — the AI will suggest one)</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Dental clinic chain cuts intake time 80%"
              className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink/60">Which niche does this fit?</span>
            <select
              value={submittedIndustry}
              onChange={(e) => setSubmittedIndustry(e.target.value)}
              className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
            >
              {INDUSTRIES.map((i) => (
                <option key={i.value} value={i.value}>
                  {i.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink/60">
              What happened, in your own words — client, situation, what you built, the actual
              result. Only state numbers you&apos;re sure of; vague is fine (&ldquo;saved a lot of
              time&rdquo;).
            </span>
            <textarea
              value={rawStory}
              onChange={(e) => setRawStory(e.target.value)}
              required
              minLength={20}
              rows={5}
              placeholder={
                "We worked with a mid-size dental clinic chain in Texas that was manually entering patient intake forms into their EHR..."
              }
              className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
            />
          </label>
          <div>
            <button
              type="submit"
              disabled={submitting || rawStory.trim().length < 20}
              className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {submitting ? "Reviewing…" : "Submit for review"}
            </button>
          </div>
        </form>
      )}

      {items === null ? (
        <p className="text-xs text-ink/50">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-ink/50">No case studies yet. Add your first one above.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((cs) => (
            <li key={cs.id} className="rounded-lg border border-[var(--line)] p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{cs.title}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] ${STATUS_STYLE[cs.status]}`}>
                  {STATUS_LABEL[cs.status]}
                </span>
                <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px] text-ink/60">
                  {industryLabel(cs.industry)}
                </span>
                {cs.industry !== cs.submittedIndustry && (
                  <span className="text-[11px] text-gold">
                    (you picked {industryLabel(cs.submittedIndustry)})
                  </span>
                )}
              </div>
              <p className="mb-2 text-sm text-ink/80">{cs.summary}</p>
              {Object.keys(cs.metrics).length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {Object.entries(cs.metrics).map(([k, v]) => (
                    <span key={k} className="rounded bg-ink/5 px-2 py-0.5 text-[11px] text-ink/70">
                      {k}: {String(v)}
                    </span>
                  ))}
                </div>
              )}
              {cs.reviewNotes && (
                <p className="mb-2 text-[11px] italic text-ink/50">AI review: {cs.reviewNotes}</p>
              )}
              <div className="flex gap-3">
                {cs.status === "NEEDS_ATTENTION" && (
                  <button
                    onClick={() => retry(cs.id)}
                    disabled={retryingId === cs.id}
                    className="text-xs text-accent hover:underline disabled:opacity-50"
                  >
                    {retryingId === cs.id ? "Retrying…" : "Retry review"}
                  </button>
                )}
                <button onClick={() => remove(cs.id)} className="text-xs text-bad hover:underline">
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
