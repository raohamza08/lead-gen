"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "../../../../lib/api-client";
import { SectionCard } from "../../../../components/chart-kit";
import { Spinner } from "../../../../components/spinner";

type Recommendation = "BID" | "MAYBE" | "SKIP";

interface DiscoveredJob {
  id: string;
  jobUrl: string;
  title: string | null;
  postedMinutesAgo: number | null;
  spendTier: string | null;
  isLongTerm: boolean | null;
  isHourly: boolean | null;
  recommendation: Recommendation;
  reasons: string[];
  discoveredAt: string;
}

interface ScrapedJobResult {
  summary: { url: string; title: string; isHourly: boolean | null; postedAt: string | null };
  detail: { ok: boolean; job?: { title?: string; description?: string; postedAt?: string; facts?: Record<string, string>; client?: Record<string, string>; skills?: string[] }; error?: string };
}

function isExtensionInstalled(): boolean {
  return document.documentElement.getAttribute("data-outly-upwork-fetcher") === "installed";
}

/** Same bridge pattern as the Proposal Writing page's single-job fetch,
 *  just for a listing scan — asks the extension to open the search page,
 *  scrape the cards there, then sequentially open each job found (capped
 *  by background.js) to get full client detail. Resolves once the
 *  extension relays one aggregated result back. */
function scanJobListViaExtension(searchUrl: string): Promise<{ ok: boolean; results?: ScrapedJobResult[]; error?: string }> {
  return new Promise((resolve) => {
    const requestId = `scan_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    function handleMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.source !== "outly-upwork-extension" || data.type !== "OUTLY_JOB_LIST_RESULT" || data.requestId !== requestId) return;
      window.removeEventListener("message", handleMessage);
      resolve({ ok: data.ok, results: data.results, error: data.error });
    }
    window.addEventListener("message", handleMessage);
    window.postMessage({ source: "outly-app", type: "OUTLY_FETCH_JOB_LIST", searchUrl, requestId }, window.location.origin);
  });
}

const RECOMMENDATION_STYLE: Record<Recommendation, string> = {
  BID: "bg-good/15 text-good",
  MAYBE: "bg-ink/8 text-ink/65",
  SKIP: "bg-bad/15 text-bad",
};

function RecommendationBadge({ value }: { value: Recommendation }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RECOMMENDATION_STYLE[value]}`}>{value}</span>;
}

/**
 * Lists recently-posted Upwork jobs with a bid/no-bid recommendation next
 * to each title (Part: Upwork Bidding SOP, explicit user request — "the
 * jobs must be listed in the system and you will be giving the
 * recommendation... next to the job title"). Scanning goes through the
 * same browser-extension mechanism as single-job generation — there's no
 * official job-search API connected yet (org hasn't completed Upwork's
 * OAuth connect, and the app isn't approved), and server-side scraping of
 * a listing page would hit the exact same Cloudflare WAF block already
 * proven on single job pages.
 */
export default function UpworkJobFeedPage() {
  const queryClient = useQueryClient();
  const [searchUrl, setSearchUrl] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);

  const jobsQuery = useQuery({
    queryKey: ["upwork-discovered-jobs"],
    queryFn: () => api.getUpworkDiscoveredJobs() as Promise<DiscoveredJob[]>,
  });

  const ingestMutation = useMutation({
    mutationFn: (jobs: unknown[]) => api.ingestUpworkDiscoveredJobs(jobs),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["upwork-discovered-jobs"] }),
  });

  const [scanning, setScanning] = useState(false);
  const [extensionInstalled, setExtensionInstalled] = useState(true); // optimistic until checked, avoids a flash of the install hint

  useEffect(() => {
    setExtensionInstalled(isExtensionInstalled());
  }, []);

  async function scan() {
    const url = searchUrl.trim();
    if (!url) return;
    setScanError(null);

    if (!isExtensionInstalled()) {
      setScanError("The Outly Upwork Fetcher extension isn't installed — see the link on the Proposal Writing page to set it up.");
      return;
    }

    setScanning(true);
    try {
      const scan = await scanJobListViaExtension(url);
      if (!scan.ok || !scan.results) {
        setScanError(scan.error ?? "Couldn't read that search page.");
        return;
      }
      const jobs = scan.results
        .filter((r) => r.detail.ok && r.detail.job)
        .map((r) => ({
          jobUrl: r.summary.url,
          title: r.detail.job!.title ?? r.summary.title,
          postedAt: r.detail.job!.postedAt ?? r.summary.postedAt ?? undefined,
          facts: r.detail.job!.facts ?? {},
          client: r.detail.job!.client ?? {},
          skills: r.detail.job!.skills ?? [],
        }));
      if (jobs.length === 0) {
        setScanError("None of the jobs on that page could be read in full (they may have closed already).");
        return;
      }
      ingestMutation.mutate(jobs);
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Job Feed</h1>
        <p className="mt-0.5 text-xs text-ink/50">
          Paste an Upwork search or category URL to scan it for jobs — each one gets the same Bidding SOP evaluation as a single generation,
          shown right next to its title.
        </p>
      </div>

      <SectionCard title="Scan a search page">
        <div className="flex flex-col gap-3">
          {!extensionInstalled && (
            <div className="rounded-lg border border-[var(--line)] bg-ink/5 px-3 py-2 text-xs text-ink/70">
              This needs the{" "}
              <a href="/extension/upwork-fetcher.zip" className="text-accent hover:underline">
                Outly Upwork Fetcher
              </a>{" "}
              browser extension installed — there&apos;s no other way to search jobs (the official Upwork search API isn&apos;t connected, and a
              server-side search would hit the same block single-job fetching already did). Download the zip, unzip it, then in Chrome go to{" "}
              <code className="rounded bg-ink/10 px-1">chrome://extensions</code> → turn on Developer mode → <strong>Load unpacked</strong> →
              pick the unzipped folder. Refresh this page once it&apos;s installed.
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="url"
              value={searchUrl}
              onChange={(e) => setSearchUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && scan()}
              placeholder="https://www.upwork.com/nx/search/jobs/?q=..."
              className="flex-1 rounded-md border border-[var(--line)] bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={scan}
              disabled={scanning || ingestMutation.isPending || !searchUrl.trim() || !extensionInstalled}
              className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {(scanning || ingestMutation.isPending) && <Spinner className="h-3.5 w-3.5" />}
              {scanning ? "Scanning…" : ingestMutation.isPending ? "Saving…" : "Scan"}
            </button>
          </div>
          {scanning && (
            <p className="text-xs text-ink/50">
              Opening the search page and each job found (up to 10) in a visible tab, one at a time — this takes a little while and closes
              everything automatically when done.
            </p>
          )}
          {scanError && (
            <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
              {scanError}
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Discovered jobs">
        {jobsQuery.isLoading ? (
          <Spinner className="h-4 w-4" />
        ) : !jobsQuery.data?.length ? (
          <p className="text-sm text-ink/55">Nothing scanned yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-[var(--line)]">
            {jobsQuery.data.map((job) => (
              <div key={job.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <RecommendationBadge value={job.recommendation} />
                    <a
                      href={job.jobUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-sm font-medium text-accent hover:underline"
                    >
                      {job.title ?? job.jobUrl}
                    </a>
                  </div>
                  <Link
                    href={`/upwork/proposal-writing?url=${encodeURIComponent(job.jobUrl)}`}
                    className="shrink-0 rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 hover:bg-ink/5"
                  >
                    Generate
                  </Link>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink/50">
                  {job.postedMinutesAgo !== null && <span>Posted {job.postedMinutesAgo} min ago</span>}
                  {job.isHourly !== null && <span>{job.isHourly ? "Hourly" : "Fixed-price"}</span>}
                  {job.isLongTerm !== null && <span>{job.isLongTerm ? "Long-term" : "Short-term"}</span>}
                </div>
                {job.reasons.length > 0 && (
                  <div className="text-xs text-ink/55">
                    {job.reasons.map((r) => (
                      <div key={r}>• {r}</div>
                    ))}
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
