"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard } from "../../../../components/chart-kit";
import { Spinner } from "../../../../components/spinner";

type JobType = "TECHNICAL" | "NON_TECHNICAL";
type SpendTier = "PRIORITY" | "RARE_LOW_RESPONSE" | "NEW_CLIENT_OK" | "STANDARD" | "UNKNOWN";

interface GenerateResult {
  draftId: string;
  fetchStatus: "SUCCESS" | "PARTIAL" | "FAILED";
  error?: string;
  jobTitle?: string;
  jobUrl?: string;
  clientNeeds?: string;
  niche?: string;
  coverLetter?: string;
  jobType?: JobType;
  suggestedProfile?: string | null;
  profileReason?: string | null;
  suggestedBidAmount?: string | null;
  spendTier?: SpendTier;
  isLongTerm?: boolean | null;
  postedMinutesAgo?: number | null;
  warnings?: string[];
  overallAssessment?: string;
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
  warnings: string[];
  createdAt: string;
}

const SPEND_TIER_LABEL: Record<SpendTier, string> = {
  PRIORITY: "Priority client ($1K–$5K spent)",
  RARE_LOW_RESPONSE: "Very high spend (>$5M) — historically low response rate",
  NEW_CLIENT_OK: "New client, no history yet — worth a shot",
  STANDARD: "Standard spend range",
  UNKNOWN: "Client spend unknown",
};

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

interface ManualFields {
  manualTitle: string;
  manualDescription: string;
  manualBudget: string;
  manualClientCountry: string;
  manualClientTotalSpent: string;
  manualPostedMinutesAgo: string;
}

const EMPTY_MANUAL: ManualFields = {
  manualTitle: "",
  manualDescription: "",
  manualBudget: "",
  manualClientCountry: "",
  manualClientTotalSpent: "",
  manualPostedMinutesAgo: "",
};

/**
 * Shown when the automatic fetch fails — most often Upwork's Cloudflare
 * bot detection blocking the server outright (confirmed directly against
 * this app's own VPS, not a fingerprint/timing issue a code tweak fixes).
 * Lets the user paste what they can already see in their own browser
 * instead of being stuck. Only the description is required; everything
 * else just sharpens the Bidding SOP signals if filled in.
 */
function ManualEntryForm({ onSubmit, pending }: { onSubmit: (fields: ManualFields) => void; pending: boolean }) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<ManualFields>(EMPTY_MANUAL);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="self-start text-sm text-accent hover:underline">
        Paste the job details manually instead →
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--line)] p-3">
      <p className="text-xs text-ink/55">
        Copy what you can see on the job page yourself. Only the description is required — the rest just sharpens the bid signals below.
      </p>
      <textarea
        value={fields.manualDescription}
        onChange={(e) => setFields({ ...fields, manualDescription: e.target.value })}
        rows={6}
        placeholder="Full job description (required)…"
        className="w-full rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={fields.manualTitle}
          onChange={(e) => setFields({ ...fields, manualTitle: e.target.value })}
          placeholder="Job title"
          className="w-56 rounded-md border border-[var(--line)] bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
        <input
          type="text"
          value={fields.manualBudget}
          onChange={(e) => setFields({ ...fields, manualBudget: e.target.value })}
          placeholder="Budget (e.g. $500 or $15/hr)"
          className="w-48 rounded-md border border-[var(--line)] bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
        <input
          type="text"
          value={fields.manualClientCountry}
          onChange={(e) => setFields({ ...fields, manualClientCountry: e.target.value })}
          placeholder="Client country"
          className="w-40 rounded-md border border-[var(--line)] bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
        <input
          type="text"
          value={fields.manualClientTotalSpent}
          onChange={(e) => setFields({ ...fields, manualClientTotalSpent: e.target.value })}
          placeholder="Client total spent (e.g. $3K)"
          className="w-48 rounded-md border border-[var(--line)] bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
        <input
          type="number"
          min={0}
          value={fields.manualPostedMinutesAgo}
          onChange={(e) => setFields({ ...fields, manualPostedMinutesAgo: e.target.value })}
          placeholder="Posted how many min ago"
          className="w-48 rounded-md border border-[var(--line)] bg-transparent px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onSubmit(fields)}
          disabled={pending || fields.manualDescription.trim().length < 20}
          className="flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {pending && <Spinner className="h-3.5 w-3.5" />}
          Generate from these details
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md px-3 py-1.5 text-sm text-ink/55 hover:bg-ink/5">
          Cancel
        </button>
      </div>
    </div>
  );
}

function Badge({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "good" | "bad" }) {
  const toneClass =
    tone === "good" ? "bg-good/15 text-good" : tone === "bad" ? "bg-bad/15 text-bad" : "bg-ink/8 text-ink/65";
  return <span className={`rounded-full px-2.5 py-1 text-xs ${toneClass}`}>{children}</span>;
}

function SignalBadges({ result }: { result: GenerateResult }) {
  const badges: { key: string; node: React.ReactNode }[] = [];
  if (result.jobType) badges.push({ key: "jobType", node: <Badge>{result.jobType === "TECHNICAL" ? "Technical" : "Non-technical"}</Badge> });
  if (result.spendTier) {
    const tone = result.spendTier === "PRIORITY" ? "good" : result.spendTier === "RARE_LOW_RESPONSE" ? "bad" : "default";
    badges.push({ key: "spend", node: <Badge tone={tone}>{SPEND_TIER_LABEL[result.spendTier]}</Badge> });
  }
  if (result.isLongTerm !== undefined && result.isLongTerm !== null) {
    badges.push({
      key: "duration",
      node: <Badge tone={result.isLongTerm ? "good" : "default"}>{result.isLongTerm ? "Long-term / ongoing" : "Short-term"}</Badge>,
    });
  }
  if (result.postedMinutesAgo !== undefined && result.postedMinutesAgo !== null) {
    const within = result.postedMinutesAgo <= 10;
    badges.push({
      key: "posted",
      node: (
        <Badge tone={within ? "good" : "bad"}>
          Posted {result.postedMinutesAgo} min ago {within ? "— within the 10-min window" : "— outside the 10-min window"}
        </Badge>
      ),
    });
  }
  if (badges.length === 0) return null;
  return <div className="flex flex-wrap gap-1.5">{badges.map((b) => b.node)}</div>;
}

/**
 * Paste an Upwork job link, get back the Bidding SOP evaluation (how good
 * the job is to bid on, client-criteria warnings, suggested bid amount and
 * freelancer profile) plus a ready-to-paste cover letter (Part: Upwork
 * Proposal Writing / Bidding SOP). Fetching is a real headless-browser
 * request server-side — it can fail (Upwork blocking the automatic fetch,
 * or the job having closed/expired) and that's surfaced here as a real
 * error, not retried silently. Criteria warnings never block generation —
 * explicit user decision: this stays advisory, the call to bid is yours.
 */
interface ExtractedJobPayload {
  title?: string;
  description?: string;
  postedAt?: string;
  facts?: Record<string, string>;
  client?: Record<string, string>;
  skills?: string[];
}

/** True once the Outly Upwork Fetcher extension's content script has run
 *  on this page — it sets this attribute immediately on load, before any
 *  message round-trip, so presence can be checked synchronously. */
function isExtensionInstalled(): boolean {
  return document.documentElement.getAttribute("data-outly-upwork-fetcher") === "installed";
}

/** Asks the extension to open the job in a real, visible tab under the
 *  user's own session, scrape it there, and close it — the only approach
 *  that actually gets past Upwork's WAF block on this app's server IP
 *  (confirmed directly, not assumed; see job-fetcher.service.ts's own
 *  docblock). Resolves once the extension's background worker relays a
 *  result back via content-app.js's window.postMessage bridge. */
function fetchJobViaExtension(jobUrl: string): Promise<{ ok: boolean; job?: ExtractedJobPayload; error?: string }> {
  return new Promise((resolve) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    function handleMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.source !== "outly-upwork-extension" || data.type !== "OUTLY_JOB_RESULT" || data.requestId !== requestId) return;
      window.removeEventListener("message", handleMessage);
      resolve({ ok: data.ok, job: data.job, error: data.error });
    }
    window.addEventListener("message", handleMessage);
    window.postMessage({ source: "outly-app", type: "OUTLY_FETCH_JOB", url: jobUrl, requestId }, window.location.origin);
  });
}

export default function UpworkProposalWritingPage() {
  const queryClient = useQueryClient();
  const [jobUrl, setJobUrl] = useState("");
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [viaExtension, setViaExtension] = useState(false);
  const [extensionInstalled, setExtensionInstalled] = useState(true); // optimistic until checked, avoids a flash of the install hint

  useEffect(() => {
    setExtensionInstalled(isExtensionInstalled());
  }, []);

  const draftsQuery = useQuery({
    queryKey: ["upwork-proposal-writing-drafts"],
    queryFn: () => api.getUpworkProposalWritingDrafts() as Promise<DraftRow[]>,
  });

  const generateMutation = useMutation({
    mutationFn: ({ url, manual, extractedJob }: { url: string; manual?: ManualFields; extractedJob?: ExtractedJobPayload }) => {
      const manualPayload = manual
        ? {
            manualTitle: manual.manualTitle || undefined,
            manualDescription: manual.manualDescription,
            manualBudget: manual.manualBudget || undefined,
            manualClientCountry: manual.manualClientCountry || undefined,
            manualClientTotalSpent: manual.manualClientTotalSpent || undefined,
            manualPostedMinutesAgo: manual.manualPostedMinutesAgo ? Number(manual.manualPostedMinutesAgo) : undefined,
          }
        : undefined;
      return api.generateUpworkCoverLetter(url, manualPayload, extractedJob) as Promise<GenerateResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["upwork-proposal-writing-drafts"] });
    },
  });

  async function submit() {
    const url = jobUrl.trim();
    if (!url) return;
    setResult(null);

    if (isExtensionInstalled()) {
      setViaExtension(true);
      try {
        const scraped = await fetchJobViaExtension(url);
        if (scraped.ok && scraped.job) {
          generateMutation.mutate({ url, extractedJob: scraped.job });
        } else {
          setResult({ draftId: "", fetchStatus: "FAILED", error: scraped.error ?? "Couldn't read that job's details." });
        }
      } finally {
        setViaExtension(false);
      }
      return;
    }

    generateMutation.mutate({ url });
  }

  function submitManual(manual: ManualFields) {
    if (!jobUrl.trim() || manual.manualDescription.trim().length < 20) return;
    setResult(null);
    generateMutation.mutate({ url: jobUrl.trim(), manual });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Proposal Writing</h1>
        <p className="mt-0.5 text-xs text-ink/50">
          Paste an Upwork job link — the system fetches the job and client details, evaluates it against the Bidding SOP, and writes a cover
          letter from it.
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
              disabled={viaExtension || generateMutation.isPending || !jobUrl.trim()}
              className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {(viaExtension || generateMutation.isPending) && <Spinner className="h-3.5 w-3.5" />}
              {viaExtension ? "Reading job…" : generateMutation.isPending ? "Generating…" : "Generate"}
            </button>
          </div>

          {viaExtension && (
            <p className="text-xs text-ink/50">Opened the job in a new tab to read it — it&apos;ll close automatically once done.</p>
          )}

          {!extensionInstalled && (
            <p className="text-xs text-ink/50">
              Tip: install the{" "}
              <a href="/extension/upwork-fetcher.zip" className="text-accent hover:underline">
                Outly Upwork Fetcher
              </a>{" "}
              browser extension for fully automatic fetching — otherwise you&apos;ll need to paste details manually if Upwork blocks the
              automatic attempt.
            </p>
          )}

          {generateMutation.isError && (
            <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
              {(generateMutation.error as Error).message}
            </div>
          )}

          {result?.fetchStatus === "FAILED" && (
            <>
              <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
                {result.error ?? "Couldn't fetch that job."}
              </div>
              <ManualEntryForm onSubmit={submitManual} pending={generateMutation.isPending} />
            </>
          )}

          {(result?.fetchStatus === "SUCCESS" || result?.fetchStatus === "PARTIAL") && (
            <div className="flex flex-col gap-4 rounded-lg border border-[var(--line)] p-4">
              {result.jobTitle && <div className="text-sm font-medium">{result.jobTitle}</div>}
              {result.fetchStatus === "PARTIAL" && (
                <Badge>From manually entered details — not an automatic fetch</Badge>
              )}

              {result.warnings && result.warnings.length > 0 && (
                <div className="flex flex-col gap-1 rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2">
                  {result.warnings.map((w) => (
                    <div key={w} className="text-sm text-bad">
                      ⚠ {w}
                    </div>
                  ))}
                </div>
              )}

              <SignalBadges result={result} />

              {result.overallAssessment && (
                <div>
                  <div className="text-label uppercase text-ink/50">Is this worth bidding on?</div>
                  <p className="mt-1 text-sm text-ink/80">{result.overallAssessment}</p>
                </div>
              )}

              <div className="flex flex-wrap gap-6">
                {result.suggestedBidAmount && (
                  <div>
                    <div className="text-label uppercase text-ink/50">Suggested bid</div>
                    <p className="mt-1 text-sm text-ink/80">{result.suggestedBidAmount}</p>
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
              </div>

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
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ink/50">{d.niche}</span>
                    {d.warnings?.length > 0 && <span className="text-xs text-bad">⚠ {d.warnings.length} warning(s)</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
