"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "../../../../lib/api-client";
import { ALLOWED_TRANSITIONS, PipelineStage } from "@leadgen/types";

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

const AGENT_LABELS: Record<string, string> = {
  lead_discovery: "Lead discovery",
  lead_verification: "Lead verification",
  company_intelligence: "Company intelligence",
  website_audit: "Website audit",
  buyer_intelligence: "Buyer intelligence",
  ai_opportunity: "AI opportunity",
  lead_scoring: "Lead scoring",
  email: "Email agent",
  review: "Review",
  linkedin: "LinkedIn",
  scheduler: "Scheduler",
  analytics: "Analytics",
  learning: "Learning",
};

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
  const [openEmailId, setOpenEmailId] = useState<string | null>(null);
  const [generatingLinkedin, setGeneratingLinkedin] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [draftingPitch, setDraftingPitch] = useState(false);

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

  // GEMINI_DRAFTING and the manual-enrichment pipeline can both run for
  // minutes with no user action in between — without a live refresh, the
  // Agent activity / Agent review sections below only ever showed what was
  // true at the moment the page loaded, which read as "stuck" even when the
  // pipeline was genuinely still working (or, before the onStageEntered fix,
  // looked identical to a lead where nothing had actually been triggered).
  const liveStage = lead?.pipelineState?.stage;
  useEffect(() => {
    if (liveStage !== PipelineStage.GEMINI_DRAFTING) return;
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveStage, params.id]);

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

  /** Undo one step. Also how a failed automated send (e.g. no mailbox
   *  configured yet) gets retried — back to Ready, then forward again. */
  async function goBack() {
    setMoving(true);
    setError(null);
    try {
      await api.moveBack(params.id);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setMoving(false);
    }
  }

  /** (Re)triggers the Gemini pitch draft — recovers a lead stuck in
   *  GEMINI_DRAFTING (see SequencerService.onStageEntered) or retries a
   *  failed run, without needing to move back and forward again. */
  async function generatePitch() {
    setDraftingPitch(true);
    setError(null);
    setNotice(null);
    try {
      await api.generatePitchDraft(params.id);
      setNotice("Pitch draft requested — this section refreshes automatically while drafting is in progress.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDraftingPitch(false);
    }
  }

  async function generateLinkedinDraft() {
    setGeneratingLinkedin(true);
    setError(null);
    setNotice(null);
    try {
      await api.generateLinkedinDraft(params.id);
      setNotice("LinkedIn copy is drafting in the background — reload in a few seconds to see it.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGeneratingLinkedin(false);
    }
  }

  /** Runs the same research/verification/scoring pipeline discovery would
   *  have — automatic for a manual lead on creation, exposed here to re-run
   *  it (a lead added before this existed, or a failed run). */
  async function runEnrichment() {
    setEnriching(true);
    setError(null);
    setNotice(null);
    try {
      await api.enrichLead(params.id);
      setNotice("Agent review is running in the background — reload in a bit to see results.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnriching(false);
    }
  }

  function copyToClipboard(label: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  async function resend(emailMessageId: string) {
    setResendingId(emailMessageId);
    setError(null);
    setNotice(null);
    try {
      await api.resendEmail(params.id, emailMessageId);
      setNotice("Email re-queued for sending.");
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResendingId(null);
    }
  }

  if (error && !lead) return <p className="text-bad">{error}</p>;
  if (!lead) return <div className="card h-64 animate-pulse" />;

  const stage: PipelineStage = lead.pipelineState?.stage ?? PipelineStage.NEW_LEAD;
  // Read from the shared state machine rather than a hardcoded map. The old map
  // still pointed NEW_LEAD at UNDER_REVIEW, which stopped being a legal
  // transition when VERIFIED and RESEARCH_COMPLETED were added — the button
  // looked fine and the API rejected every click.
  const nextStages = ALLOWED_TRANSITIONS[stage] ?? [];
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
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lead.pipelineState?.previousStage && (
            <button
              onClick={goBack}
              disabled={moving}
              title={`Move back to ${stageLabel(lead.pipelineState.previousStage)}`}
              className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
            >
              ← Back
            </button>
          )}
          <span className="rounded-full bg-ink/8 px-3 py-1 text-xs font-medium">{stageLabel(stage)}</span>
          {stage === PipelineStage.GEMINI_DRAFTING && (
            <button
              onClick={generatePitch}
              disabled={draftingPitch}
              title="Use this if the lead has sat here without the Agent activity trail below showing an email/scheduler run."
              className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
            >
              {draftingPitch ? "Requesting…" : "Generate pitch draft"}
            </button>
          )}
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

          {Array.isArray(lead.agentRuns) && lead.agentRuns.length > 0 && (
            <section className="card p-5">
              <h2 className="mb-1 text-sm font-semibold tracking-tight">Agent activity</h2>
              <p className="mb-3 text-xs text-ink/50">
                Every agent that has touched this lead, in order. Rows appear as each agent
                finishes, not only once a whole pipeline completes — this page refreshes itself
                every few seconds while the lead is in Drafting so you can watch it happen.
              </p>
              <div className="flex flex-col gap-1.5">
                {lead.agentRuns.map((r: any) => (
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
            <h2 className="mb-3 text-sm font-semibold tracking-tight">Contact</h2>
            <Field label="Decision maker">
              {lead.contactName ? `${lead.contactName}${lead.jobTitle ? ` — ${lead.jobTitle}` : ""}` : null}
            </Field>
            <Field label="Email">{lead.email}</Field>
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
                              : "Queued"}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span
                          className={`rounded px-2 py-0.5 text-[11px] ${
                            m.status === "SENT"
                              ? "bg-good/20 text-good"
                              : m.status === "FAILED"
                                ? "bg-bad/20 text-bad"
                                : "bg-ink/8 text-ink/60"
                          }`}
                        >
                          {m.status}
                        </span>
                        {Array.isArray(m.events) && m.events.some((e: any) => e.eventType === "OPENED") ? (
                          <span className="text-[11px] text-accent">
                            Opened{" "}
                            {(() => {
                              const opens = m.events.filter((e: any) => e.eventType === "OPENED");
                              const last = opens[opens.length - 1];
                              return `${new Date(last.occurredAt).toLocaleString()}${opens.length > 1 ? ` (${opens.length}×)` : ""}`;
                            })()}
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
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-tight">LinkedIn</h2>
              <button
                onClick={generateLinkedinDraft}
                disabled={generatingLinkedin}
                className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
              >
                {generatingLinkedin ? "Requesting…" : "Generate LinkedIn copy"}
              </button>
            </div>
            <p className="mb-3 text-xs text-ink/50">
              Drafts a connection note and two follow-ups for you to copy and send yourself — LinkedIn
              outreach is never automated here.
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
            <div className="mb-0.5 flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-tight">Agent review</h2>
              <button
                onClick={runEnrichment}
                disabled={enriching}
                className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
              >
                {enriching ? "Running…" : "Run agent review"}
              </button>
            </div>
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
                Not generated yet — runs automatically for manually-added leads, or click &ldquo;Run
                agent review&rdquo; above.
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
