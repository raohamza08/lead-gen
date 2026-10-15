"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard } from "../../../../components/chart-kit";
import { Spinner } from "../../../../components/spinner";

interface GenerateResult {
  draftId: string;
  fetchStatus: "SUCCESS" | "PARTIAL" | "FAILED";
  error?: string;
  jobTitle?: string;
  jobUrl?: string;
  clientNeeds?: string;
  niche?: string;
  coverLetter?: string;
}

interface DraftRow {
  id: string;
  jobUrl: string;
  jobTitle: string | null;
  niche: string;
  clientNeeds: string;
  coverLetter: string;
  fetchStatus: "SUCCESS" | "PARTIAL" | "FAILED";
  fetchError: string | null;
  createdAt: string;
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

/**
 * Paste an Upwork job link, get back what the client needs, the niche, and
 * a ready-to-paste cover letter (Part: Upwork Proposal Writing, explicit
 * user request). Fetching is a real headless-browser request server-side —
 * it can fail (Upwork blocking the automatic fetch, or the job having
 * closed/expired) and that's surfaced here as a real error, not retried
 * silently, since each attempt costs real time/resources.
 */
export default function UpworkProposalWritingPage() {
  const queryClient = useQueryClient();
  const [jobUrl, setJobUrl] = useState("");
  const [result, setResult] = useState<GenerateResult | null>(null);

  const draftsQuery = useQuery({
    queryKey: ["upwork-proposal-writing-drafts"],
    queryFn: () => api.getUpworkProposalWritingDrafts() as Promise<DraftRow[]>,
  });

  const generateMutation = useMutation({
    mutationFn: (url: string) => api.generateUpworkCoverLetter(url) as Promise<GenerateResult>,
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["upwork-proposal-writing-drafts"] });
    },
  });

  function submit() {
    if (!jobUrl.trim()) return;
    setResult(null);
    generateMutation.mutate(jobUrl.trim());
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Proposal Writing</h1>
        <p className="mt-0.5 text-xs text-ink/50">
          Paste an Upwork job link — the system fetches the job and client details and writes a cover letter from it.
        </p>
      </div>

      <SectionCard title="Generate">
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              type="url"
              value={jobUrl}
              onChange={(e) => setJobUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="https://www.upwork.com/jobs/~..."
              className="flex-1 rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={submit}
              disabled={generateMutation.isPending || !jobUrl.trim()}
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

          {result?.fetchStatus === "FAILED" && (
            <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
              {result.error ?? "Couldn't fetch that job."}
            </div>
          )}

          {result?.fetchStatus === "SUCCESS" && (
            <div className="flex flex-col gap-4 rounded-lg border border-[var(--line)] p-4">
              {result.jobTitle && <div className="text-sm font-medium">{result.jobTitle}</div>}

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
              <div key={d.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-2">
                  <a href={d.jobUrl} target="_blank" rel="noreferrer" className="truncate text-sm font-medium text-accent hover:underline">
                    {d.jobTitle ?? d.jobUrl}
                  </a>
                  <span className="shrink-0 text-xs text-ink/40">{new Date(d.createdAt).toLocaleString()}</span>
                </div>
                {d.fetchStatus === "FAILED" ? (
                  <span className="text-xs text-bad">{d.fetchError}</span>
                ) : (
                  <span className="text-xs text-ink/50">{d.niche}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
