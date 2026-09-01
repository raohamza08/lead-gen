"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "../../../../lib/api-client";
import { useRealtimeEvent } from "../../../../lib/realtime";
import { AGENT_LABELS } from "../../../../lib/agent-labels";
import { ALLOWED_TRANSITIONS, PIPELINE_STAGE_ORDER, PipelineStage, isValidRewind } from "@leadgen/types";

const REVIEW_FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: "businessProblems", label: "Business problems" },
  { key: "websiteIssues", label: "Website issues" },
  { key: "painPoints", label: "Pain points" },
  { key: "opportunities", label: "Opportunities" },
  { key: "automationOpportunities", label: "Automation opportunities" },
  { key: "crmIssues", label: "CRM issues" },
  { key: "suggestedService", label: "Suggested service" },
  { key: "suggestedOffer", label: "Suggested offer" },
  { key: "suggestedCaseStudy", label: "Suggested case study" },
  { key: "suggestedHook", label: "Suggested hook", hint: "The opening line the email should lead with." },
  { key: "notes", label: "Notes" },
];

const stageLabel = (s: string) =>
  s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

function agentStatusTone(status: string) {
  if (status === "OK") return "text-good";
  if (status === "DEGRADED") return "text-gold";
  if (status === "SKIPPED") return "text-ink/45";
  return "text-bad";
}

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

function tone(v?: number | null) {
  if (v == null) return "text-ink/35";
  if (v >= 75) return "text-good";
  if (v >= 50) return "text-gold";
  return "text-ink/60";
}

function Score({ label, value }: { label: string; value?: number | null }) {
  return (
    <div className="rounded-lg border border-[var(--line)] px-2.5 py-2">
      <div className="text-[10px] uppercase leading-tight tracking-wide text-ink/50">{label}</div>
      <div className={`tabular mt-0.5 text-lg font-semibold ${tone(value)}`}>{value ?? "—"}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div className="border-t border-[var(--line)] py-2.5 first:border-t-0">
      <div className="text-[10px] uppercase tracking-wide text-ink/50">{label}</div>
      <div className="mt-1 text-sm leading-relaxed text-ink/80">{children}</div>
    </div>
  );
}

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const [lead, setLead] = useState<any>(null);
  const [review, setReview] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [editingContact, setEditingContact] = useState(false);
  const [contactDraft, setContactDraft] = useState({
    email: "", contactName: "", jobTitle: "", phone: "", verifiedEmail: false,
  });
  const [savingContact, setSavingContact] = useState(false);
  const [openEmailId, setOpenEmailId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [runningAgent, setRunningAgent] = useState<{ agent: string; responsibility?: string } | null>(null);
  const runningAgentRef = useRef<string | null>(null);
  const staleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function load() {
    api
      .getLead(params.id)
      .then((data: any) => {
        setLead(data);
        setReview(data.reviewNote ?? {});
      })
      .catch((err) => setError((err as Error).message));
  }

  useEffect(load, [params.id]);

  // Every agent-driven pipeline (email drafting, manual-lead enrichment,
  // LinkedIn copy) can run for minutes with no user action in between — this
  // used to need an 8s poll while a draft was in flight; now every relevant
  // event pushes live, for this lead specifically, the moment it happens,
  // and nothing on this page ever needs a manual refresh.
  type LeadEvent = { leadId: string };
  const refetchIfThisLead = (payload: LeadEvent) => {
    if (payload.leadId === params.id) load();
  };
  useRealtimeEvent<LeadEvent>("lead.updated", refetchIfThisLead);
  useRealtimeEvent<LeadEvent>("lead.stageChanged", refetchIfThisLead);
  // Part: Preparation Pipeline / Sending Queue, 2026-09-01 — preparation
  // progress, queue/schedule status, and session outcomes for this lead's
  // emails, pushed live with no page refresh needed. sendingQueue/
  // sendingSession events aren't leadId-scoped (they key off the message/
  // session, not the lead), so this page just reloads on either — one extra
  // GET while this specific lead's detail page happens to be open.
  useRealtimeEvent<LeadEvent>("preparation.updated", refetchIfThisLead);
  useRealtimeEvent("sendingQueue.updated", load);
  useRealtimeEvent("sendingSession.updated", load);

  // Live "an agent is working on this lead right now" indicator. `started`
  // fires the instant the orchestrator picks the agent up; cleared once
  // either that same agent's `recorded` (finished) event arrives, or a
  // dispatch failure means it never will. A 5-minute stale-clear guards
  // against the rare case neither arrives (worker crash mid-run) — every
  // real agent step finishes well inside that.
  const clearStaleTimer = () => {
    if (staleTimer.current) clearTimeout(staleTimer.current);
    staleTimer.current = null;
  };
  useRealtimeEvent<LeadEvent & { agent: string; responsibility?: string }>("agentRun.started", (payload) => {
    if (payload.leadId !== params.id) return;
    runningAgentRef.current = payload.agent;
    setRunningAgent({ agent: payload.agent, responsibility: payload.responsibility });
    clearStaleTimer();
    staleTimer.current = setTimeout(() => {
      runningAgentRef.current = null;
      setRunningAgent(null);
    }, 5 * 60 * 1000);
  });
  useRealtimeEvent<LeadEvent & { agent: string; status: string }>("agentRun.recorded", (payload) => {
    if (payload.leadId !== params.id) return;
    load();
    if (runningAgentRef.current === payload.agent) {
      runningAgentRef.current = null;
      setRunningAgent(null);
      clearStaleTimer();
    }
  });
  useRealtimeEvent<LeadEvent & { kind: string; status: string }>("agentDispatch.status", (payload) => {
    if (payload.leadId !== params.id) return;
    load();
    if (payload.status === "FAILED") {
      runningAgentRef.current = null;
      setRunningAgent(null);
      clearStaleTimer();
    }
  });
  useEffect(() => clearStaleTimer, []);

  async function saveReview() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.updateReview(params.id, review);
      setNotice("Review saved. It now takes precedence over the AI's findings in outreach.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /** For a Lead Room lead (no PipelineState yet) — promotes just this one,
   *  via the same endpoint the Lead Room bulk action uses, scoped to this
   *  lead's own id so it can't accidentally sweep in others. */
  async function promoteThisLead() {
    setMoving(true);
    setError(null);
    try {
      await api.promoteLeadsToPipeline({ leadId: params.id });
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setMoving(false);
    }
  }

  async function advance(stage: string) {
    setMoving(true);
    setError(null);
    try {
      await api.advanceStage(params.id, stage);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setMoving(false);
    }
  }

  /** Back to any earlier stage, not only the one immediately before this —
   *  also how a failed automated send (e.g. no mailbox configured yet) gets
   *  retried: back to Ready, then forward again. */
  async function rewind(toStage: string) {
    setMoving(true);
    setError(null);
    try {
      await api.rewindLead(params.id, toStage);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setMoving(false);
    }
  }

  function copyToClipboard(label: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  function openContactEditor() {
    setContactDraft({
      email: lead.email ?? "",
      contactName: lead.contactName ?? "",
      jobTitle: lead.jobTitle ?? "",
      phone: lead.phone ?? "",
      verifiedEmail: Boolean(lead.verifiedEmail),
    });
    setEditingContact(true);
  }

  async function saveContact(e: React.FormEvent) {
    e.preventDefault();
    setSavingContact(true);
    setError(null);
    setNotice(null);
    try {
      await api.updateLeadContact(params.id, contactDraft);
      setEditingContact(false);
      setNotice("Contact info updated.");
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingContact(false);
    }
  }

  async function resend(emailMessageId: string) {
    setResendingId(emailMessageId);
    setError(null);
    setNotice(null);
    try {
      const result = (await api.resendEmail(params.id, emailMessageId)) as { status: "SENT" | "FAILED"; failureReason?: string };
      if (result.status === "SENT") {
        setNotice("Email sent.");
      } else {
        setError(`Send failed: ${result.failureReason ?? "unknown error"}`);
      }
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResendingId(null);
    }
  }

  if (error && !lead) return <p className="text-bad">{error}</p>;
  if (!lead) return <div className="card h-64 animate-pulse" />;

  // No PipelineState row means this lead hasn't been promoted out of Lead
  // Room yet (Part: Lead Room / Move to Pipeline) — the stage-transition
  // controls below don't apply until it has one, so they're replaced with
  // a single "Promote to Pipeline" action instead.
  const isPromoted = !!lead.pipelineState;
  const stage: PipelineStage = lead.pipelineState?.stage ?? PipelineStage.READY_FOR_OUTREACH;
  // Read from the shared state machine rather than a hardcoded map — see its
  // own doc comment for why (a hardcoded map here previously drifted out of
  // sync with a state-machine change made elsewhere).
  const nextStages = ALLOWED_TRANSITIONS[stage] ?? [];
  const backOptions = PIPELINE_STAGE_ORDER.filter((s) => isValidRewind(stage, s));
  const s = lead.score ?? {};
  const swot = lead.swotAnalysis ?? {};
  const hasSwot = Object.values(swot).some((v) => Array.isArray(v) && v.length);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/leads" className="text-xs text-ink/50 hover:text-ink">← Leads</Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{lead.companyName}</h1>
          <p className="mt-0.5 text-sm text-ink/55">
            {[lead.industry, lead.country, lead.employeeCount && `${lead.employeeCount} staff`]
              .filter(Boolean).join(" · ") || "No firmographics yet"}
          </p>
          {/* Part: Lead Upload Analytics, 2026-09-01 — absent for an
              AI-discovered lead, which nobody uploaded. */}
          {lead.uploadedByUser && (
            <p className="mt-0.5 text-xs text-ink/45">
              Uploaded by {lead.uploadedByUser.name} · {new Date(lead.createdAt).toLocaleString()}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isPromoted ? (
            <>
              {backOptions.length > 0 && (
                <select
                  key={stage}
                  defaultValue=""
                  disabled={moving}
                  onChange={(e) => {
                    if (e.target.value) rewind(e.target.value);
                  }}
                  title="Move this lead back to an earlier stage — a correction, not a transition, so it skips the forward automation."
                  className="rounded-lg border border-[var(--line)] bg-transparent px-3 py-1.5 text-xs font-medium text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
                >
                  <option value="" disabled>← Back to…</option>
                  {backOptions.map((s) => (
                    <option key={s} value={s}>{stageLabel(s)}</option>
                  ))}
                </select>
              )}
              <span className="rounded-full bg-ink/8 px-3 py-1 text-xs font-medium">{stageLabel(stage)}</span>
              {nextStages.map((next) => (
                <button
                  key={next}
                  onClick={() => advance(next)}
                  disabled={moving}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-50 ${
                    next === PipelineStage.LOST
                      ? "border border-[var(--line)] text-bad"
                      : "bg-accent text-white"
                  }`}
                >
                  → {stageLabel(next)}
                </button>
              ))}
              {stage !== PipelineStage.LOST && !nextStages.includes(PipelineStage.LOST) && (
                <button
                  onClick={() => advance(PipelineStage.LOST)}
                  disabled={moving}
                  className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-bad disabled:opacity-50"
                >
                  Mark lost
                </button>
              )}
            </>
          ) : (
            <>
              <span className="rounded-full bg-gold/15 px-3 py-1 text-xs font-medium text-gold">Lead Room</span>
              <button
                onClick={promoteThisLead}
                disabled={moving}
                className="rounded-lg bg-accent px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {moving ? "Moving…" : "Promote to Pipeline"}
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="card border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">{error}</div>
      )}
      {notice && (
        <div className="card border-[rgb(var(--good-rgb)/0.4)] bg-[rgb(var(--good-rgb)/0.06)] px-3 py-2 text-sm text-good">{notice}</div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="flex flex-col gap-4">
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold tracking-tight">Scores</h2>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              <Score label="Priority" value={s.leadPriorityScore ?? s.leadScore} />
              <Score label="Business fit" value={s.businessFitScore} />
              <Score label="AI opportunity" value={s.aiOpportunityScore} />
              <Score label="Buying intent" value={s.buyingIntentScore} />
              <Score label="Budget" value={s.budgetScore} />
              <Score label="Tech gap" value={s.technologyGapScore} />
              <Score label="DM access" value={s.decisionMakerAccessScore} />
              <Score label="Confidence" value={s.confidenceScore} />
              <Score label="AI readiness" value={s.aiReadinessScore} />
              <Score label="Digital maturity" value={s.digitalMaturityScore} />
              <Score label="Website" value={s.websiteQualityScore} />
              <Score label="Authority" value={s.authorityScore} />
            </div>
            {s.fitReason && (
              <p className="mt-4 border-l-2 border-accent/40 pl-3 text-sm italic leading-relaxed text-ink/70">
                {s.fitReason}
              </p>
            )}
            {s.expectedValue != null && (
              <p className="mt-3 text-xs text-ink/50">
                Estimated value: <span className="font-medium text-ink/75">${Number(s.expectedValue).toLocaleString()}</span>
                {s.projectComplexity && ` · ${s.projectComplexity.toLowerCase()} complexity`}
              </p>
            )}
          </section>

          <section className="card p-5">
            <h2 className="mb-2 text-sm font-semibold tracking-tight">Company intelligence</h2>
            <Field label="Summary">{lead.businessDescription}</Field>
            <Field label="Pain points">{lead.painPoints}</Field>
            <Field label="AI opportunities">{lead.aiOpportunities}</Field>
            <Field label="Automation opportunities">{lead.automationOpportunities}</Field>
            <Field label="Buyer persona">{lead.buyerPersona}</Field>
            <Field label="Website issues (UX)">{lead.uxIssues}</Field>
            <Field label="Website issues (SEO)">{lead.seoIssues}</Field>
            <Field label="Competitors">
              {Array.isArray(lead.competitors) && lead.competitors.length ? lead.competitors.join(", ") : null}
            </Field>
            <Field label="Tech stack">
              {Array.isArray(lead.techStack) && lead.techStack.length
                ? lead.techStack.map((t: any) => (typeof t === "string" ? t : t?.name)).filter(Boolean).join(", ")
                : null}
            </Field>
            <Field label="Growth signals">
              {Array.isArray(lead.growthSignals) && lead.growthSignals.length ? lead.growthSignals.join(" · ") : null}
            </Field>
            {/* Evidence is what makes a score auditable rather than something to
                take on trust, so it is shown, not hidden behind a toggle. */}
            <Field label="Research evidence">{lead.researchEvidence}</Field>
          </section>

          {((Array.isArray(lead.agentRuns) && lead.agentRuns.length > 0) || runningAgent) && (
            <section className="card p-5">
              <h2 className="mb-1 text-sm font-semibold tracking-tight">Agent activity</h2>
              <p className="mb-3 text-xs text-ink/50">
                Every agent that has touched this lead, in order. Rows appear live, as each
                agent starts and finishes — nothing here needs a manual refresh.
              </p>
              {runningAgent && (
                <div className="mb-2 flex items-center gap-2 rounded-lg border border-accent/25 bg-accent/8 px-3 py-2 text-xs">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                  <span className="font-medium text-ink/80">
                    {AGENT_LABELS[runningAgent.agent] ?? runningAgent.agent} is working on this lead now
                  </span>
                  {runningAgent.responsibility && (
                    <span className="truncate text-ink/50">— {runningAgent.responsibility}</span>
                  )}
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                {(lead.agentRuns ?? []).map((r: any) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-2 border-t border-[var(--line)] py-1.5 text-xs first:border-t-0"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className={agentStatusTone(r.status)}>●</span>
                      <span className="text-ink/80">{AGENT_LABELS[r.agent] ?? r.agent}</span>
                      {r.notes?.length > 0 && (
                        <span className="truncate text-ink/40" title={r.notes.join("; ")}>
                          — {r.notes[0]}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-ink/45">
                      <span className={agentStatusTone(r.status)}>{r.status}</span>
                      <span className="tabular">{fmtMs(r.durationMs)}</span>
                      <span>{new Date(r.startedAt).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {hasSwot && (
            <section className="card p-5">
              <h2 className="mb-3 text-sm font-semibold tracking-tight">SWOT</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {(["strengths", "weaknesses", "opportunities", "threats"] as const).map((k) =>
                  Array.isArray(swot[k]) && swot[k].length ? (
                    <div key={k} className="rounded-lg border border-[var(--line)] p-3">
                      <div className="text-[10px] uppercase tracking-wide text-ink/50">{k}</div>
                      <ul className="mt-1.5 space-y-1 text-xs text-ink/75">
                        {swot[k].map((item: string, i: number) => <li key={i}>· {item}</li>)}
                      </ul>
                    </div>
                  ) : null,
                )}
              </div>
            </section>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-tight">Contact</h2>
              {!editingContact && (
                <button
                  onClick={openContactEditor}
                  className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 hover:bg-ink/5"
                >
                  Edit
                </button>
              )}
            </div>

            {!lead.email && !editingContact && (
              <div className="mb-3 rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-xs text-bad">
                No email on file — outreach cannot start and every send will fail until one is added.
              </div>
            )}

            {editingContact ? (
              <form onSubmit={saveContact} className="flex flex-col gap-2.5">
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-wide text-ink/50">Email</span>
                  <input
                    type="email"
                    value={contactDraft.email}
                    onChange={(e) => setContactDraft((d) => ({ ...d, email: e.target.value }))}
                    className="w-full rounded border border-[var(--line)] bg-transparent px-2.5 py-1.5 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-wide text-ink/50">Decision maker</span>
                  <input
                    value={contactDraft.contactName}
                    onChange={(e) => setContactDraft((d) => ({ ...d, contactName: e.target.value }))}
                    className="w-full rounded border border-[var(--line)] bg-transparent px-2.5 py-1.5 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-wide text-ink/50">Job title</span>
                  <input
                    value={contactDraft.jobTitle}
                    onChange={(e) => setContactDraft((d) => ({ ...d, jobTitle: e.target.value }))}
                    className="w-full rounded border border-[var(--line)] bg-transparent px-2.5 py-1.5 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-wide text-ink/50">Phone</span>
                  <input
                    value={contactDraft.phone}
                    onChange={(e) => setContactDraft((d) => ({ ...d, phone: e.target.value }))}
                    className="w-full rounded border border-[var(--line)] bg-transparent px-2.5 py-1.5 text-sm"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-ink/70">
                  <input
                    type="checkbox"
                    checked={contactDraft.verifiedEmail}
                    onChange={(e) => setContactDraft((d) => ({ ...d, verifiedEmail: e.target.checked }))}
                  />
                  I&apos;ve confirmed this email is real and reachable — required before outreach can start.
                </label>
                <div className="mt-1 flex gap-2">
                  <button
                    type="submit"
                    disabled={savingContact}
                    className="rounded-md bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-50"
                  >
                    {savingContact ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingContact(false)}
                    className="rounded-md border border-[var(--line)] px-3 py-1.5 text-xs text-ink/70 hover:bg-ink/5"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <Field label="Decision maker">
                  {lead.contactName ? `${lead.contactName}${lead.jobTitle ? ` — ${lead.jobTitle}` : ""}` : null}
                </Field>
                <Field label="Email">{lead.email}</Field>
                <Field label="Personal email">{lead.personalEmail}</Field>
                <Field label="Phone">{lead.phone}</Field>
                <Field label="Website">
                  {lead.website ? (
                    <a href={lead.website} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                      {lead.website.replace(/^https?:\/\//, "")}
                    </a>
                  ) : null}
                </Field>
                <Field label="Company LinkedIn">
                  {lead.linkedinUrl ? (
                    <a href={lead.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                      View profile
                    </a>
                  ) : null}
                </Field>
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--line)] pt-3">
                  {[
                    ["Website", lead.verifiedWebsite],
                    ["Email", lead.verifiedEmail],
                    ["LinkedIn", lead.verifiedLinkedin],
                  ].map(([label, ok]) => (
                    <span
                      key={label as string}
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        ok ? "bg-[rgb(var(--good-rgb)/0.12)] text-good" : "bg-ink/8 text-ink/50"
                      }`}
                    >
                      {ok ? "✓" : "○"} {label as string} {ok ? "verified" : "unverified"}
                    </span>
                  ))}
                </div>
              </>
            )}
          </section>

          {Array.isArray(lead.emailMessages) && lead.emailMessages.length > 0 && (
            <section className="card p-5">
              <h2 className="mb-3 text-sm font-semibold tracking-tight">Emails</h2>
              <div className="flex flex-col gap-2">
                {lead.emailMessages.map((m: any) => (
                  <div key={m.id} className="rounded-lg border border-[var(--line)] p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-medium text-ink/80">
                          #{m.sequenceStep} — {m.subject}
                        </div>
                        <div className="mt-1 text-[11px] text-ink/50">
                          {m.sentAt
                            ? `Sent ${new Date(m.sentAt).toLocaleString()}`
                            : m.status === "FAILED"
                              ? "Failed to send"
                              : m.status === "WAITING_FOR_SCHEDULE" && m.scheduledAt
                                ? `Scheduled for ${new Date(m.scheduledAt).toLocaleString()}`
                                : m.status === "SENDING"
                                  ? "Sending…"
                                  : m.status === "RETRY_SCHEDULED"
                                    ? `Retrying${m.nextSendRetryAt ? ` at ${new Date(m.nextSendRetryAt).toLocaleTimeString()}` : ""}`
                                    : m.status === "READY_TO_SEND"
                                      ? "Ready to send"
                                      : m.status === "PENDING_APPROVAL"
                                        ? "Awaiting approval"
                                        : "Queued"}
                        </div>
                        {m.status === "FAILED" && m.failureReason && (
                          <div className="mt-1 text-[11px] text-bad">{m.failureReason}</div>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span
                          className={`rounded px-2 py-0.5 text-[11px] ${
                            m.status === "SENT"
                              ? "bg-good/20 text-good"
                              : m.status === "FAILED"
                                ? "bg-bad/20 text-bad"
                                : m.status === "SENDING"
                                  ? "bg-accent/20 text-accent"
                                  : m.status === "RETRY_SCHEDULED"
                                    ? "bg-gold/20 text-gold"
                                    : "bg-ink/8 text-ink/60"
                          }`}
                        >
                          {m.status}
                        </span>
                        {/* Only a verified open counts (Part: 3-minute open verification,
                            2026-09-01) — a raw EmailEvent{OPENED} inside the first 3 minutes
                            after sending is a prefetch/scanner hit, not a person reading it,
                            so it must not show here even though it's still logged internally. */}
                        {m.verifiedOpenedAt ? (
                          <span className="text-[11px] text-accent">
                            Opened {new Date(m.verifiedOpenedAt).toLocaleString()}
                          </span>
                        ) : m.status === "SENT" ? (
                          <span className="text-[11px] text-ink/35">Not opened yet</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={() => setOpenEmailId(openEmailId === m.id ? null : m.id)}
                        className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5"
                      >
                        {openEmailId === m.id ? "Hide" : "View email"}
                      </button>
                      {m.status === "FAILED" && (
                        <button
                          onClick={() => resend(m.id)}
                          disabled={resendingId === m.id}
                          className="rounded-md bg-accent px-2.5 py-1 text-xs text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                          {resendingId === m.id ? "Resending…" : "Resend"}
                        </button>
                      )}
                    </div>
                    {openEmailId === m.id && (
                      // Sandboxed with no allow-scripts/allow-same-origin: bodyHtml can
                      // trace back to scraped website content by way of the drafting
                      // agent's context, so it is untrusted input, not just our own
                      // template output. srcDoc renders the formatting without letting
                      // anything in it execute in the dashboard's origin.
                      <iframe
                        title={`Email ${m.sequenceStep} body`}
                        srcDoc={m.bodyHtml}
                        sandbox=""
                        className="mt-2 h-64 w-full rounded-lg border border-[var(--line)] bg-white"
                      />
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="card p-5">
            <h2 className="mb-1 text-sm font-semibold tracking-tight">LinkedIn</h2>
            <p className="mb-3 text-xs text-ink/50">
              A connection note and two follow-ups are drafted automatically alongside Email #1 — for
              you to copy and send yourself. LinkedIn outreach itself is never automated here.
            </p>
            {(() => {
              const activity = Array.isArray(lead.linkedinActivities) ? lead.linkedinActivities[0] : null;
              const messages = activity?.draftMessages as
                | { connectionNote?: string; followUpMessage?: string; secondFollowUp?: string; rationale?: string }
                | null
                | undefined;
              if (!messages) {
                return <p className="text-xs text-ink/40">No draft yet.</p>;
              }
              const fields: { key: string; label: string }[] = [
                { key: "connectionNote", label: "Connection note" },
                { key: "followUpMessage", label: "Follow-up 1" },
                { key: "secondFollowUp", label: "Follow-up 2" },
              ];
              return (
                <div className="flex flex-col gap-2">
                  {fields.map(
                    (f) =>
                      messages[f.key as keyof typeof messages] && (
                        <div key={f.key} className="rounded-lg border border-[var(--line)] p-3">
                          <div className="mb-1 flex items-center justify-between">
                            <span className="text-[10px] uppercase tracking-wide text-ink/50">{f.label}</span>
                            <button
                              onClick={() => copyToClipboard(f.key, messages[f.key as keyof typeof messages] as string)}
                              className="text-[11px] text-accent hover:underline"
                            >
                              {copied === f.key ? "Copied" : "Copy"}
                            </button>
                          </div>
                          <p className="text-sm leading-relaxed text-ink/80">
                            {messages[f.key as keyof typeof messages] as string}
                          </p>
                        </div>
                      ),
                  )}
                </div>
              );
            })()}
          </section>

          <section className="card p-5">
            <h2 className="mb-0.5 text-sm font-semibold tracking-tight">Agent review</h2>
            <p className="mb-3 mt-0.5 text-xs text-ink/50">
              The same fields as Human review below, but read and filled in by the AI from its own
              research — a starting point to agree with, correct, or override, not the final word.
            </p>
            {lead.agentReview ? (
              <div className="flex flex-col">
                {REVIEW_FIELDS.map((field) => (
                  <Field key={field.key} label={field.label}>
                    {lead.agentReview[field.key]}
                  </Field>
                ))}
              </div>
            ) : (
              <p className="text-xs text-ink/40">
                Not generated yet — runs automatically once research and scoring finish.
              </p>
            )}
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-semibold tracking-tight">Human review</h2>
            <p className="mb-4 mt-0.5 text-xs text-ink/50">
              What you write here <strong>overrides</strong> the AI&apos;s findings when the email is
              generated — you have context the model doesn&apos;t.
            </p>
            <div className="flex flex-col gap-3">
              {REVIEW_FIELDS.map((field) => (
                <label key={field.key} className="block">
                  <span className="mb-1 block text-xs text-ink/60">{field.label}</span>
                  {field.hint && <span className="mb-1 block text-[11px] text-ink/40">{field.hint}</span>}
                  <textarea
                    className="w-full rounded-lg border border-[var(--line)] bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-[rgb(var(--accent-rgb)/0.6)]"
                    rows={2}
                    value={review[field.key] ?? ""}
                    onChange={(e) => setReview({ ...review, [field.key]: e.target.value })}
                  />
                </label>
              ))}
              <button
                onClick={saveReview}
                disabled={saving}
                className="mt-1 self-start rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save review"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
