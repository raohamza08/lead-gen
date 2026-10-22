"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard, KpiStrip, StatTile } from "../../../../components/chart-kit";
import { Modal } from "../../../../components/ui/modal";
import { UpworkAgencyConnectionGate, UpworkConnectionStatus } from "../../../../components/upwork-agency-connection-gate";

interface MarketplaceJob {
  id: string;
  title: string;
  description: string;
  category: string | null;
  subcategory: string | null;
  experienceLevel: string | null;
  duration: string | null;
  durationLabel: string | null;
  engagement: string | null;
  engagementWeeks: number | null;
  recordNumber: string;
  freelancersToHire: number;
  enterprise: boolean;
  premium: boolean;
  applied: boolean;
  createdDateTime: string;
  publishedDateTime: string;
  renewedDateTime: string | null;
  totalApplicants: number;
  preferredFreelancerLocation: string[];
  preferredFreelancerLocationMandatory: boolean;
  budgetDisplay: string | null;
  fixedAmount: string | null;
  hourlyBudgetType: string | null;
  hourlyBudgetMin: string | null;
  hourlyBudgetMax: string | null;
  weeklyBudget: string | null;
  skills: { name: string; prettyName: string; highlighted: boolean }[];
  client: {
    totalHires: number;
    totalPostedJobs: number;
    totalReviews: number;
    totalFeedback: number;
    verificationStatus: string | null;
    hasFinancialPrivacy: boolean;
    totalSpentDisplay: string | null;
    country: string | null;
  };
}

interface FreelancerProfile {
  id: string;
  name: string;
  niche: string;
  active: boolean;
}

const JUST_POSTED_WINDOW_MIN = 15;
const STOPWORDS = new Set(["and", "the", "for", "with", "development", "design", "services"]);

function minutesAgo(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 60000;
}

function timeAgoLabel(iso: string): string {
  const m = minutesAgo(iso);
  if (m < 1) return "just now";
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Buckets jobs by the best-matching freelancer-profile niche (Part:
 *  Marketplace Jobs categorization, 2026-10-23, explicit user request —
 *  "they all should be categorized on the based of my profile category
 *  that i have added in the proposal writing section"). Upwork's niches
 *  are freeform text, not a fixed taxonomy, so this is a simple
 *  real-data keyword match (niche words found in the job's own title/
 *  category/subcategory/skills) rather than an exact lookup — a job that
 *  matches no configured niche lands in "Other", never silently dropped. */
function categorize(jobs: MarketplaceJob[], niches: string[]): { niche: string; jobs: MarketplaceJob[] }[] {
  if (niches.length === 0) return [{ niche: "All jobs", jobs }];

  const nicheWords = niches.map((n) => ({
    niche: n,
    words: n.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  }));

  const buckets = new Map<string, MarketplaceJob[]>();
  for (const n of niches) buckets.set(n, []);
  buckets.set("Other", []);

  for (const job of jobs) {
    const haystack = [job.title, job.category ?? "", job.subcategory ?? "", ...job.skills.map((s) => s.prettyName)]
      .join(" ")
      .toLowerCase();
    let best: { niche: string; score: number } | null = null;
    for (const { niche, words } of nicheWords) {
      const score = words.reduce((acc, w) => acc + (haystack.includes(w) ? 1 : 0), 0);
      if (score > 0 && (!best || score > best.score)) best = { niche, score };
    }
    buckets.get(best?.niche ?? "Other")!.push(job);
  }

  return [...niches.map((n) => ({ niche: n, jobs: buckets.get(n)! })), { niche: "Other", jobs: buckets.get("Other")! }].filter(
    (g) => g.jobs.length > 0,
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: "accent" | "good" | "neutral" }) {
  const cls =
    tone === "accent"
      ? "bg-accent/15 text-accent"
      : tone === "good"
        ? "bg-good/15 text-good"
        : "bg-ink/8 text-ink/60";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>{children}</span>;
}

function JobRow({ job, onOpen }: { job: MarketplaceJob; onOpen: () => void }) {
  const justPosted = minutesAgo(job.publishedDateTime) <= JUST_POSTED_WINDOW_MIN;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-1.5 rounded-lg border border-[var(--line)] px-3.5 py-3 text-left transition-colors hover:bg-ink/[0.04]"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="line-clamp-1 text-sm font-medium text-ink">{job.title}</span>
        <span className="shrink-0 text-[11px] text-ink/40">{timeAgoLabel(job.publishedDateTime)}</span>
      </div>
      <p className="line-clamp-2 text-xs text-ink/50">{job.description}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {justPosted && <Badge tone="accent">New</Badge>}
        {job.budgetDisplay && <Badge>{job.budgetDisplay}</Badge>}
        {job.experienceLevel && <Badge>{job.experienceLevel}</Badge>}
        {job.client.verificationStatus === "VERIFIED" && <Badge tone="good">Payment verified</Badge>}
        {job.applied && <Badge tone="good">Applied</Badge>}
        <span className="text-[11px] text-ink/40">{job.totalApplicants} applicants</span>
      </div>
    </button>
  );
}

function JobDetail({ job }: { job: MarketplaceJob }) {
  return (
    <div className="flex flex-col gap-5 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        {minutesAgo(job.publishedDateTime) <= JUST_POSTED_WINDOW_MIN && <Badge tone="accent">New</Badge>}
        {job.premium && <Badge>Premium</Badge>}
        {job.enterprise && <Badge>Enterprise</Badge>}
        {job.applied && <Badge tone="good">Applied</Badge>}
        {job.experienceLevel && <Badge>{job.experienceLevel}</Badge>}
        {job.category && <Badge>{job.category}</Badge>}
        {job.subcategory && <Badge>{job.subcategory}</Badge>}
      </div>

      <dl className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <dt className="text-ink/50">Budget</dt>
          <dd className="font-medium text-ink">
            {job.fixedAmount
              ? `${job.fixedAmount} (fixed)`
              : job.hourlyBudgetMin || job.hourlyBudgetMax
                ? `${job.hourlyBudgetMin ?? "?"}–${job.hourlyBudgetMax ?? "?"}/hr${job.hourlyBudgetType ? ` (${job.hourlyBudgetType})` : ""}`
                : job.weeklyBudget
                  ? `${job.weeklyBudget}/week`
                  : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-ink/50">Duration</dt>
          <dd className="font-medium text-ink">{job.durationLabel ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-ink/50">Engagement</dt>
          <dd className="font-medium text-ink">{job.engagement ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-ink/50">Freelancers to hire</dt>
          <dd className="font-medium text-ink">{job.freelancersToHire}</dd>
        </div>
        <div>
          <dt className="text-ink/50">Applicants</dt>
          <dd className="font-medium text-ink">{job.totalApplicants}</dd>
        </div>
        <div>
          <dt className="text-ink/50">Posted</dt>
          <dd className="font-medium text-ink">{new Date(job.publishedDateTime).toLocaleString()}</dd>
        </div>
        {job.renewedDateTime && (
          <div>
            <dt className="text-ink/50">Renewed</dt>
            <dd className="font-medium text-ink">{new Date(job.renewedDateTime).toLocaleString()}</dd>
          </div>
        )}
        {job.preferredFreelancerLocation.length > 0 && (
          <div className="col-span-2">
            <dt className="text-ink/50">Preferred location{job.preferredFreelancerLocationMandatory ? " (required)" : ""}</dt>
            <dd className="font-medium text-ink">{job.preferredFreelancerLocation.join(", ")}</dd>
          </div>
        )}
      </dl>

      {job.skills.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink/55">Skills</h4>
          <div className="flex flex-wrap gap-1.5">
            {job.skills.map((s) => (
              <span
                key={s.name}
                className={`rounded-full px-2.5 py-1 text-xs ${s.highlighted ? "bg-accent/15 text-accent" : "bg-ink/8 text-ink/65"}`}
              >
                {s.prettyName}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink/55">Description</h4>
        <p className="whitespace-pre-wrap text-sm text-ink/80">{job.description}</p>
      </div>

      <div>
        <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink/55">Client</h4>
        <dl className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-ink/50">Payment verification</dt>
            <dd className="font-medium text-ink">{job.client.verificationStatus ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-ink/50">Country</dt>
            <dd className="font-medium text-ink">{job.client.country ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-ink/50">Total hires</dt>
            <dd className="font-medium text-ink">{job.client.totalHires}</dd>
          </div>
          <div>
            <dt className="text-ink/50">Jobs posted</dt>
            <dd className="font-medium text-ink">{job.client.totalPostedJobs}</dd>
          </div>
          <div>
            <dt className="text-ink/50">Reviews</dt>
            <dd className="font-medium text-ink">
              {job.client.totalReviews} ({job.client.totalFeedback ? job.client.totalFeedback.toFixed(2) : "—"}★)
            </dd>
          </div>
          <div>
            <dt className="text-ink/50">Total spent</dt>
            <dd className="font-medium text-ink">
              {job.client.hasFinancialPrivacy ? "Private" : job.client.totalSpentDisplay ?? "—"}
            </dd>
          </div>
        </dl>
      </div>

      <p className="text-[11px] text-ink/40">Record #{job.recordNumber} · Upwork ID {job.id}</p>
    </div>
  );
}

/** Marketplace Jobs (spec Modules G + S). Part: Upwork API integration —
 *  Marketplace Jobs redesign, 2026-10-23, explicit user request: most
 *  recent jobs first, jobs posted within the last 15 minutes pinned at
 *  the top, grouped by the user's own freelancer-profile niches (from
 *  the Proposal Writing section), and every field click-through to full
 *  detail rather than a flat basic table. Live public-marketplace search
 *  only — not synced/stored (see UpworkMarketplaceJobsService's own
 *  docblock for why). */
export default function MarketplaceJobsPage() {
  const statusQuery = useQuery({ queryKey: ["upwork-api-status"], queryFn: () => api.getUpworkApiStatus() as Promise<UpworkConnectionStatus> });
  const connected = Boolean(statusQuery.data?.connected);

  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [openJobId, setOpenJobId] = useState<string | null>(null);

  const jobsQuery = useQuery({
    queryKey: ["upwork-api-marketplace-jobs", query],
    queryFn: () => api.getUpworkApiMarketplaceJobs(query || undefined) as Promise<{ totalCount: number | null; jobs: MarketplaceJob[] }>,
    enabled: connected,
  });
  const jobs = jobsQuery.data;

  // Freelancer-profile niches power the categorization below. A person
  // granted Marketplace Jobs access but not Proposal Writing access gets a
  // clean 403 here — caught rather than letting it break the whole page,
  // falling back to a single flat "All jobs" group.
  const profilesQuery = useQuery({
    queryKey: ["upwork-freelancer-profiles-for-jobs"],
    queryFn: () => api.getUpworkFreelancerProfiles() as Promise<FreelancerProfile[]>,
    enabled: connected,
    retry: false,
    throwOnError: false,
  });
  const niches = useMemo(
    () => [...new Set((profilesQuery.data ?? []).filter((p) => p.active).map((p) => p.niche.trim()).filter(Boolean))],
    [profilesQuery.data],
  );

  const allJobs = jobs?.jobs ?? [];
  const sorted = useMemo(
    () => [...allJobs].sort((a, b) => new Date(b.publishedDateTime).getTime() - new Date(a.publishedDateTime).getTime()),
    [allJobs],
  );
  const justPosted = sorted.filter((j) => minutesAgo(j.publishedDateTime) <= JUST_POSTED_WINDOW_MIN);
  const rest = sorted.filter((j) => minutesAgo(j.publishedDateTime) > JUST_POSTED_WINDOW_MIN);
  const groups = useMemo(() => categorize(rest, niches), [rest, niches]);

  const openJob = sorted.find((j) => j.id === openJobId) ?? null;

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Marketplace Jobs" />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Marketplace Jobs</h1>
        <p className="mt-0.5 text-xs text-ink/50">
          Live public marketplace data, sorted newest first — jobs posted in the last {JUST_POSTED_WINDOW_MIN} minutes are pinned at the top.
          {niches.length > 0 ? " Grouped by your freelancer-profile niches below." : " Add freelancer profiles in Proposal Writing to group these by niche."}
        </p>
      </div>

      <SectionCard title="Search">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search);
          }}
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search public job postings…"
            className="h-9 flex-1 rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm"
          />
          <button type="submit" className="h-9 rounded-md bg-accent px-4 text-sm text-white">
            Search
          </button>
        </form>
      </SectionCard>

      {jobsQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
      {jobsQuery.error && <p className="text-sm text-bad">{(jobsQuery.error as Error).message}</p>}

      {jobs && (
        <>
          <KpiStrip>
            <StatTile label="Total matching (public marketplace)" value={jobs.totalCount ?? "—"} />
            <StatTile label="Posted in last 15 min" value={justPosted.length} />
            <StatTile label="Loaded" value={sorted.length} />
          </KpiStrip>

          {justPosted.length > 0 && (
            <SectionCard title={`Posted in the last ${JUST_POSTED_WINDOW_MIN} minutes`}>
              <div className="flex flex-col gap-2">
                {justPosted.map((job) => (
                  <JobRow key={job.id} job={job} onOpen={() => setOpenJobId(job.id)} />
                ))}
              </div>
            </SectionCard>
          )}

          {groups.map(({ niche, jobs: groupJobs }) => (
            <SectionCard key={niche} title={niche}>
              <div className="flex flex-col gap-2">
                {groupJobs.map((job) => (
                  <JobRow key={job.id} job={job} onOpen={() => setOpenJobId(job.id)} />
                ))}
              </div>
            </SectionCard>
          ))}

          {sorted.length === 0 && (
            <SectionCard title="Results">
              <p className="text-sm text-ink/55">No jobs match this search.</p>
            </SectionCard>
          )}
        </>
      )}

      <Modal open={Boolean(openJob)} onOpenChange={(open) => !open && setOpenJobId(null)} variant="drawer-right" title={openJob?.title ?? "Job"} contentClassName="w-full max-w-xl">
        {openJob && <JobDetail job={openJob} />}
      </Modal>
    </div>
  );
}
