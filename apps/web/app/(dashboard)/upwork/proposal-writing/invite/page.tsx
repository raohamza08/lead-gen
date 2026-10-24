"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../../lib/api-client";
import { SectionCard } from "../../../../../components/chart-kit";
import { Spinner } from "../../../../../components/spinner";

type JobType = "TECHNICAL" | "NON_TECHNICAL";

interface GenerateResult {
  draftId: string;
  createdByName?: string | null;
  clientName?: string | null;
  clientNeeds?: string;
  niche?: string;
  coverLetter?: string;
  jobType?: JobType;
  suggestedProfile?: string | null;
  profileReason?: string | null;
  overallAssessment?: string;
}

interface DraftRow {
  id: string;
  inviteText: string;
  clientName: string | null;
  niche: string;
  clientNeeds: string;
  coverLetter: string;
  jobType: JobType | null;
  suggestedProfile: string | null;
  profileReason: string | null;
  overallAssessment: string | null;
  createdByName: string | null;
  createdAt: string;
}

function draftToResult(d: DraftRow): GenerateResult {
  return {
    draftId: d.id,
    createdByName: d.createdByName,
    clientName: d.clientName,
    clientNeeds: d.clientNeeds,
    niche: d.niche,
    coverLetter: d.coverLetter,
    jobType: d.jobType ?? undefined,
    suggestedProfile: d.suggestedProfile,
    profileReason: d.profileReason,
    overallAssessment: d.overallAssessment ?? undefined,
  };
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/65 transition-colors hover:bg-ink/5"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-ink/8 px-2.5 py-1 text-xs text-ink/65">{children}</span>;
}

/**
 * Paste the raw content of an Upwork INVITE (the client's message, plus
 * whatever job details they included) and get back a ready-to-paste cover
 * letter — same Bidding SOP voice/settings/freelancer-profile suggestion as
 * the job-link flow in Proposal Writing, just without the deterministic
 * bidding signals (spend tier, country, posting age) that only a scraped
 * job page exposes (Part: Invite Proposal Writing, 2026-10-24).
 */
export default function InviteProposalWritingPage() {
  const queryClient = useQueryClient();
  const [inviteText, setInviteText] = useState("");
  const [knownClientName, setKnownClientName] = useState("");
  const [result, setResult] = useState<GenerateResult | null>(null);

  const draftsQuery = useQuery({
    queryKey: ["upwork-invite-proposal-writing-drafts"],
    queryFn: () => api.getUpworkInviteProposalDrafts() as Promise<DraftRow[]>,
  });

  const generateMutation = useMutation({
    mutationFn: () => api.generateUpworkInviteCoverLetter(inviteText.trim(), knownClientName.trim()) as Promise<GenerateResult>,
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["upwork-invite-proposal-writing-drafts"] });
    },
  });

  function submit() {
    if (inviteText.trim().length < 20) return;
    setResult(null);
    generateMutation.mutate();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Invite Proposal Writing</h1>
        <p className="mt-1 text-sm text-ink/55">Paste an Upwork invite message to generate a cover letter — no job link needed.</p>
      </div>

      <SectionCard title="Generate">
        <div className="flex flex-col gap-3">
          <textarea
            value={inviteText}
            onChange={(e) => setInviteText(e.target.value)}
            rows={8}
            placeholder="Paste the full invite message here…"
            className="w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={knownClientName}
              onChange={(e) => setKnownClientName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Client name, if known"
              className="w-56 rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={submit}
              disabled={generateMutation.isPending || inviteText.trim().length < 20}
              className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {generateMutation.isPending && <Spinner className="h-3.5 w-3.5" />}
              {generateMutation.isPending ? "Generating…" : "Generate"}
            </button>
          </div>

          {generateMutation.isError && (
            <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
              {(generateMutation.error as Error).message}
            </div>
          )}

          {result && (
            <div className="flex flex-col gap-4 rounded-lg border border-[var(--line)] p-4">
              <div className="flex items-start justify-between gap-2">
                <div>{result.clientName && <div className="text-xs text-ink/50">Client: {result.clientName}</div>}</div>
                {result.createdByName && (
                  <span className="shrink-0 text-xs text-ink/50">
                    Generated by <span className="font-medium text-ink/70">{result.createdByName}</span>
                  </span>
                )}
              </div>

              {result.jobType && <Badge>{result.jobType === "TECHNICAL" ? "Technical" : "Non-technical"}</Badge>}

              {result.overallAssessment && (
                <div>
                  <div className="text-label uppercase text-ink/50">Is this worth bidding on?</div>
                  <p className="mt-1 text-sm text-ink/80">{result.overallAssessment}</p>
                </div>
              )}

              {result.suggestedProfile && (
                <div>
                  <div className="text-label uppercase text-ink/50">Best-fit profile</div>
                  <p className="mt-1 text-sm text-ink/80">
                    <span className="font-medium">{result.suggestedProfile}</span>
                    {result.profileReason && <span className="text-ink/60"> — {result.profileReason}</span>}
                  </p>
                </div>
              )}

              {result.niche && (
                <div>
                  <div className="text-label uppercase text-ink/50">Niche</div>
                  <div className="mt-1 inline-block rounded-full bg-primary/10 px-2.5 py-1 text-sm text-primary">{result.niche}</div>
                </div>
              )}

              {result.clientNeeds && (
                <div>
                  <div className="text-label uppercase text-ink/50">What the client needs</div>
                  <p className="mt-1 text-sm text-ink/80">{result.clientNeeds}</p>
                </div>
              )}

              {result.coverLetter && (
                <div>
                  <div className="flex items-center justify-between">
                    <div className="text-label uppercase text-ink/50">Cover letter</div>
                    <CopyButton text={result.coverLetter} />
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink/80">{result.coverLetter}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Recent">
        {draftsQuery.isLoading ? (
          <Spinner className="h-4 w-4" />
        ) : !draftsQuery.data?.length ? (
          <p className="text-sm text-ink/55">Nothing generated yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-[var(--line)]">
            {draftsQuery.data.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  setResult(draftToResult(d));
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="flex flex-col gap-1 rounded-md px-2 -mx-2 py-3 text-left first:pt-0 last:pb-0 hover:bg-ink/5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{d.clientName || d.niche || "Invite"}</span>
                  <span className="shrink-0 text-xs text-ink/40">{new Date(d.createdAt).toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="truncate text-xs text-ink/50">{d.inviteText.slice(0, 80)}</span>
                  {d.createdByName && <span className="shrink-0 text-xs text-ink/40">by {d.createdByName}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
