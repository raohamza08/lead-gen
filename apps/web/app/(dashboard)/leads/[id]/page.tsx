"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../../lib/api-client";

const REVIEW_FIELDS: { key: string; label: string }[] = [
  { key: "websiteIssues", label: "Website Issues" },
  { key: "businessProblems", label: "Business Problems" },
  { key: "opportunities", label: "Possible Opportunities" },
  { key: "automationOpportunities", label: "Automation Opportunities" },
  { key: "suggestedService", label: "Suggested Service" },
  { key: "suggestedOffer", label: "Suggested Offer" },
  { key: "suggestedHook", label: "Suggested Hook" },
  { key: "painPoints", label: "Pain Points" },
  { key: "notes", label: "Notes" },
];

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const [lead, setLead] = useState<any>(null);
  const [review, setReview] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getLead(params.id)
      .then((data: any) => {
        setLead(data);
        setReview(data.reviewNote ?? {});
      })
      .catch((err) => setError((err as Error).message));
  }, [params.id]);

  async function saveReview() {
    setSaving(true);
    try {
      await api.updateReview(params.id, review);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function advance(stage: string) {
    try {
      await api.advanceStage(params.id, stage);
      const refreshed = await api.getLead(params.id);
      setLead(refreshed);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (error) return <p className="text-bad">{error}</p>;
  if (!lead) return <p className="text-ink/60">Loading…</p>;

  const stage = lead.pipelineState?.stage;
  const nextStageMap: Record<string, string> = {
    NEW_LEAD: "UNDER_REVIEW",
    UNDER_REVIEW: "READY_FOR_OUTREACH",
  };
  const nextStage = nextStageMap[stage];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section className="rounded-lg border border-[var(--line)] p-5">
        <h1 className="text-lg font-semibold">{lead.companyName}</h1>
        <p className="mt-1 text-sm text-ink/60">
          {lead.industry ?? "—"} · {lead.companySize ?? "—"} · {lead.country ?? "—"}
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <span className="rounded bg-black/5 px-2 py-1">{lead.website ?? "no website"}</span>
          <span className="rounded bg-black/5 px-2 py-1">{lead.email ?? "no email"}</span>
          <span className="rounded bg-black/5 px-2 py-1">{lead.linkedinUrl ?? "no linkedin"}</span>
        </div>

        <h2 className="mb-2 mt-6 text-xs uppercase tracking-wide text-ink/60">AI Scores</h2>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <ScoreCell label="Lead" value={lead.score?.leadScore} />
          <ScoreCell label="Confidence" value={lead.score?.confidenceScore} />
          <ScoreCell label="AI Opportunity" value={lead.score?.aiOpportunityScore} />
          <ScoreCell label="Automation" value={lead.score?.automationScore} />
          <ScoreCell label="CRM Ready" value={lead.score?.crmReadinessScore} />
          <ScoreCell label="Website" value={lead.score?.websiteQualityScore} />
        </div>
        {lead.score?.fitReason && (
          <p className="mt-3 text-sm italic text-ink/70">&ldquo;{lead.score.fitReason}&rdquo;</p>
        )}

        <div className="mt-6 flex items-center justify-between">
          <span className="rounded bg-accent/10 px-2 py-1 text-sm text-accent">{stage}</span>
          {nextStage && (
            <button onClick={() => advance(nextStage)} className="rounded bg-accent px-3 py-1.5 text-sm text-white">
              Move to {nextStage.replaceAll("_", " ")}
            </button>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-[var(--line)] p-5">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-ink/60">Human Review</h2>
        <div className="flex flex-col gap-3">
          {REVIEW_FIELDS.map((field) => (
            <div key={field.key}>
              <label className="mb-1 block text-xs text-ink/60">{field.label}</label>
              <textarea
                className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                rows={2}
                value={review[field.key] ?? ""}
                onChange={(e) => setReview({ ...review, [field.key]: e.target.value })}
              />
            </div>
          ))}
          <button
            onClick={saveReview}
            disabled={saving}
            className="mt-2 self-start rounded bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save review"}
          </button>
        </div>
      </section>
    </div>
  );
}

function ScoreCell({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded bg-black/5 p-2">
      <div className="text-[11px] text-ink/50">{label}</div>
      <div className="tabular font-semibold">{value ?? "—"}</div>
    </div>
  );
}
