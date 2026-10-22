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
  ciphertext: string;
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
  fixedAmountRaw: number | null;
  hourlyBudgetType: string | null;
  hourlyBudgetMin: string | null;
  hourlyBudgetMinRaw: number | null;
  hourlyBudgetMax: string | null;
  hourlyBudgetMaxRaw: number | null;
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
const PAGE_SIZE_OPTIONS = [15, 25, 50];

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

function jobHaystack(job: MarketplaceJob): string {
  return [job.title, job.category ?? "", job.subcategory ?? "", ...job.skills.map((s) => s.prettyName)].join(" ").toLowerCase();
}

function nicheWordList(niche: string): string[] {
  return niche.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/** Upwork's real public job-posting URL (Part: "copy job link" fix,
 *  2026-10-23 — the first version used `~<recordNumber>`, confirmed by
 *  the user NOT to open the real job; `ciphertext` is the correct real
 *  field, already shaped like `~02<id>` matching Upwork's own URL
 *  pattern — see UpworkGraphQLClient.searchMarketplaceJobs's docblock
 *  for why). */
function jobUrl(job: MarketplaceJob): string {
  return `https://www.upwork.com/jobs/${job.ciphertext}`;
}

function categorize(jobs: MarketplaceJob[], niches: string[]): { niche: string; jobs: MarketplaceJob[] }[] {
  if (niches.length === 0) return [{ niche: "All jobs", jobs }];

  const nicheWords = niches.map((n) => ({ niche: n, words: nicheWordList(n) }));

  const buckets = new Map<string, MarketplaceJob[]>();
  for (const n of niches) buckets.set(n, []);
  buckets.set("Other", []);

  for (const job of jobs) {
    const haystack = jobHaystack(job);
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

/** Which of the user's own freelancer profiles (from Proposal Writing)
 *  best fits bidding on this specific job (Part: Marketplace Jobs
 *  "recommended profile", 2026-10-23, explicit user request). Same
 *  real-data keyword-overlap heuristic as the niche grouping above, just
 *  scored per-job — a job matching no profile's niche gets no
 *  recommendation rather than a guessed one. */
function matchProfile(job: MarketplaceJob, profiles: FreelancerProfile[]): { profile: FreelancerProfile; matchedWords: string[] } | null {
  const haystack = jobHaystack(job);
  let best: { profile: FreelancerProfile; score: number; matchedWords: string[] } | null = null;
  for (const profile of profiles) {
    const words = nicheWordList(profile.niche);
    const matchedWords = words.filter((w) => haystack.includes(w));
    if (matchedWords.length > 0 && (!best || matchedWords.length > best.score)) {
      best = { profile, score: matchedWords.length, matchedWords };
    }
  }
  return best ? { profile: best.profile, matchedWords: best.matchedWords } : null;
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: "accent" | "good" | "neutral" }) {
  const cls = tone === "accent" ? "bg-accent/15 text-accent" : tone === "good" ? "bg-good/15 text-good" : "bg-ink/8 text-ink/60";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>{children}</span>;
}

function JobRow({ job, profiles, onOpen }: { job: MarketplaceJob; profiles: FreelancerProfile[]; onOpen: () => void }) {
  const justPosted = minutesAgo(job.publishedDateTime) <= JUST_POSTED_WINDOW_MIN;
  const match = matchProfile(job, profiles);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-2 rounded-lg border border-[var(--line)] px-3.5 py-3 text-left transition-colors hover:bg-ink/[0.04]"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="line-clamp-1 text-sm font-medium text-ink">{job.title}</span>
        <span className="shrink-0 text-[11px] text-ink/40">{timeAgoLabel(job.publishedDateTime)}</span>
      </div>
      <p className="line-clamp-2 text-xs text-ink/50">{job.description}</p>
      {job.skills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {job.skills.slice(0, 4).map((s) => (
            <span key={s.name} className="rounded-full bg-ink/8 px-2 py-0.5 text-[10px] text-ink/55">
              {s.prettyName}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge>Upwork</Badge>
        {justPosted && <Badge tone="accent">New</Badge>}
        {match && <Badge tone="good">Apply as {match.profile.name}</Badge>}
        {job.budgetDisplay && <Badge>{job.budgetDisplay}</Badge>}
        {job.experienceLevel && <Badge>{job.experienceLevel}</Badge>}
        {job.client.verificationStatus === "VERIFIED" && <Badge tone="good">Payment verified</Badge>}
        {job.applied && <Badge tone="good">Applied</Badge>}
        <span className="text-[11px] text-ink/40">{job.totalApplicants} applicants</span>
      </div>
    </button>
  );
}

function JobDetail({ job, profiles }: { job: MarketplaceJob; profiles: FreelancerProfile[] }) {
  const [copied, setCopied] = useState(false);
  const match = matchProfile(job, profiles);
  const url = jobUrl(job);

  async function copyLink() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-5 text-sm">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copyLink}
          className="rounded-md border border-[var(--line)] px-3 py-1.5 text-xs text-ink/70 transition-colors hover:bg-ink/5"
        >
          {copied ? "Link copied" : "Copy job link"}
        </button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-[var(--line)] px-3 py-1.5 text-xs text-ink/70 transition-colors hover:bg-ink/5"
        >
          Open in Upwork ↗
        </a>
      </div>

      {match && (
        <div className="rounded-lg border border-accent/30 bg-accent/10 px-3.5 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-accent">Recommended profile to apply from</p>
          <p className="mt-1 text-sm font-medium text-ink">{match.profile.name}</p>
          <p className="text-xs text-ink/55">
            Niche: {match.profile.niche} · matched on {match.matchedWords.join(", ")}
          </p>
        </div>
      )}
      {!match && profiles.length > 0 && (
        <p className="text-xs text-ink/45">No freelancer profile&apos;s niche matches this job closely — review manually before applying.</p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge>Upwork</Badge>
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
            <dd className="font-medium text-ink">{job.client.hasFinancialPrivacy ? "Private" : job.client.totalSpentDisplay ?? "—"}</dd>
          </div>
        </dl>
      </div>

      <p className="text-[11px] text-ink/40">Record #{job.recordNumber} · Upwork ID {job.id}</p>
    </div>
  );
}

/** Marketplace Jobs (spec Modules G + S). Part: Upwork API integration —
 *  Marketplace Jobs redesign, 2026-10-23, matched to the user's "Dark
 *  SaaS Marketplace Jobs Dashboard" reference image where the underlying
 *  data genuinely supports it (filter panel, stat cards, pagination
 *  bar, table-style rows). Deliberately does NOT replicate the
 *  mockup's multi-platform elements (Upwork/Freelancer/Fiverr/
 *  PeoplePerHour tabs, "Other Platforms" count, numbered page-jump
 *  buttons): this app has exactly one live job-marketplace source
 *  (Upwork's own GraphQL search), no Fiverr/Freelancer.com/
 *  PeoplePerHour integration exists anywhere in this codebase, and
 *  Upwork's own pagination is cursor-based (confirmed live), not
 *  offset/page-number based — building those would mean fabricating
 *  data or capabilities this app doesn't have. Live public-marketplace
 *  search only — not synced/stored. */
export default function MarketplaceJobsPage() {
  const statusQuery = useQuery({ queryKey: ["upwork-api-status"], queryFn: () => api.getUpworkApiStatus() as Promise<UpworkConnectionStatus> });
  const connected = Boolean(statusQuery.data?.connected);

  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [openJobId, setOpenJobId] = useState<string | null>(null);

  const [categoryFilter, setCategoryFilter] = useState("all");
  const [experienceFilter, setExperienceFilter] = useState("all");
  const [jobTypeFilter, setJobTypeFilter] = useState<"all" | "fixed" | "hourly">("all");
  const [postedWithin, setPostedWithin] = useState<"any" | "1h" | "24h" | "7d">("any");
  const [locationFilter, setLocationFilter] = useState("all");
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [maxApplicants, setMaxApplicants] = useState("");

  const currentCursor = cursorStack[pageIndex] ?? null;
  const jobsQuery = useQuery({
    queryKey: ["upwork-api-marketplace-jobs", query, currentCursor, pageSize],
    queryFn: () =>
      api.getUpworkApiMarketplaceJobs(query || undefined, currentCursor || undefined, pageSize) as Promise<{
        totalCount: number | null;
        pageInfo: { endCursor: string | null; hasNextPage: boolean };
        jobs: MarketplaceJob[];
      }>,
    enabled: connected,
  });
  const jobs = jobsQuery.data;

  function resetPaging() {
    setCursorStack([null]);
    setPageIndex(0);
  }

  function goNext() {
    if (!jobs?.pageInfo.hasNextPage || !jobs.pageInfo.endCursor) return;
    const next = cursorStack.slice(0, pageIndex + 1);
    next.push(jobs.pageInfo.endCursor);
    setCursorStack(next);
    setPageIndex(next.length - 1);
  }
  function goPrevious() {
    if (pageIndex === 0) return;
    setPageIndex(pageIndex - 1);
  }

  // Freelancer-profile niches power categorization + the recommended-profile
  // banner. A person granted Marketplace Jobs access but not Proposal
  // Writing access gets a clean 403 here — caught rather than letting it
  // break the whole page, falling back to a single flat "All jobs" group.
  const profilesQuery = useQuery({
    queryKey: ["upwork-freelancer-profiles-for-jobs"],
    queryFn: () => api.getUpworkFreelancerProfiles() as Promise<FreelancerProfile[]>,
    enabled: connected,
    retry: false,
    throwOnError: false,
  });
  const activeProfiles = useMemo(() => (profilesQuery.data ?? []).filter((p) => p.active && p.niche.trim()), [profilesQuery.data]);
  const niches = useMemo(() => [...new Set(activeProfiles.map((p) => p.niche.trim()))], [activeProfiles]);

  const allJobs = useMemo(() => jobs?.jobs ?? [], [jobs]);
  const categories = useMemo(() => [...new Set(allJobs.map((j) => j.category).filter((c): c is string => Boolean(c)))], [allJobs]);
  const experienceLevels = useMemo(() => [...new Set(allJobs.map((j) => j.experienceLevel).filter((e): e is string => Boolean(e)))], [allJobs]);
  const locations = useMemo(() => [...new Set(allJobs.map((j) => j.client.country).filter((c): c is string => Boolean(c)))], [allJobs]);

  const maxApplicantsNum = maxApplicants.trim() === "" ? null : Number(maxApplicants);
  const budgetMinNum = budgetMin.trim() === "" ? null : Number(budgetMin);
  const budgetMaxNum = budgetMax.trim() === "" ? null : Number(budgetMax);
  const hasFilters =
    categoryFilter !== "all" ||
    experienceFilter !== "all" ||
    jobTypeFilter !== "all" ||
    postedWithin !== "any" ||
    locationFilter !== "all" ||
    budgetMinNum != null ||
    budgetMaxNum != null ||
    maxApplicantsNum != null;

  function clearFilters() {
    setCategoryFilter("all");
    setExperienceFilter("all");
    setJobTypeFilter("all");
    setPostedWithin("any");
    setLocationFilter("all");
    setBudgetMin("");
    setBudgetMax("");
    setMaxApplicants("");
  }

  const sorted = useMemo(() => {
    const postedWithinMin = postedWithin === "1h" ? 60 : postedWithin === "24h" ? 24 * 60 : postedWithin === "7d" ? 7 * 24 * 60 : null;
    return [...allJobs]
      .filter((j) => (categoryFilter === "all" ? true : j.category === categoryFilter))
      .filter((j) => (experienceFilter === "all" ? true : j.experienceLevel === experienceFilter))
      .filter((j) => (locationFilter === "all" ? true : j.client.country === locationFilter))
      .filter((j) => (jobTypeFilter === "all" ? true : jobTypeFilter === "fixed" ? j.fixedAmountRaw != null : j.fixedAmountRaw == null))
      .filter((j) => (postedWithinMin == null ? true : minutesAgo(j.publishedDateTime) <= postedWithinMin))
      .filter((j) => (maxApplicantsNum == null ? true : j.totalApplicants <= maxApplicantsNum))
      .filter((j) => {
        if (budgetMinNum == null && budgetMaxNum == null) return true;
        const lo = j.fixedAmountRaw ?? j.hourlyBudgetMinRaw ?? 0;
        const hi = j.fixedAmountRaw ?? j.hourlyBudgetMaxRaw ?? Infinity;
        if (budgetMinNum != null && hi < budgetMinNum) return false;
        if (budgetMaxNum != null && lo > budgetMaxNum) return false;
        return true;
      })
      .sort((a, b) => new Date(b.publishedDateTime).getTime() - new Date(a.publishedDateTime).getTime());
  }, [allJobs, categoryFilter, experienceFilter, locationFilter, jobTypeFilter, postedWithin, maxApplicantsNum, budgetMinNum, budgetMaxNum]);

  const justPosted = sorted.filter((j) => minutesAgo(j.publishedDateTime) <= JUST_POSTED_WINDOW_MIN);
  const rest = sorted.filter((j) => minutesAgo(j.publishedDateTime) > JUST_POSTED_WINDOW_MIN);
  const groups = useMemo(() => categorize(rest, niches), [rest, niches]);
  const appliedCount = allJobs.filter((j) => j.applied).length;

  const openJob = sorted.find((j) => j.id === openJobId) ?? null;

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Marketplace Jobs" />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Marketplace Jobs</h1>
          <p className="mt-0.5 text-xs text-ink/50">
            Live public marketplace data from Upwork&apos;s own search — not your agency&apos;s records, not synced or stored. Sorted newest
            first on this page; jobs posted in the last {JUST_POSTED_WINDOW_MIN} minutes are pinned at the top.
            {niches.length > 0 ? " Grouped by your freelancer-profile niches below." : " Add freelancer profiles in Proposal Writing to group these by niche."}
          </p>
        </div>
        <a
          href={`https://www.upwork.com/nx/search/jobs/${query ? `?q=${encodeURIComponent(query)}` : ""}`}
          target="_blank"
          rel="noreferrer"
          className="h-9 shrink-0 rounded-md bg-accent px-3.5 text-xs font-medium text-white transition-opacity hover:opacity-90 flex items-center"
        >
          Open in Upwork ↗
        </a>
      </div>

      <SectionCard title="Search & filters" subtitle="Filters apply to the jobs currently loaded on this page, not Upwork's full catalog.">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search);
            resetPaging();
          }}
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, skills, keywords…"
            className="h-9 flex-1 rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm"
          />
          <button type="submit" className="h-9 rounded-md bg-accent px-4 text-sm text-white">
            Search
          </button>
        </form>

        {allJobs.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {categories.length > 0 && (
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="h-9 rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm">
                <option value="all">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
            {experienceLevels.length > 0 && (
              <select value={experienceFilter} onChange={(e) => setExperienceFilter(e.target.value)} className="h-9 rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm">
                <option value="all">Any experience level</option>
                {experienceLevels.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            )}
            <select value={jobTypeFilter} onChange={(e) => setJobTypeFilter(e.target.value as typeof jobTypeFilter)} className="h-9 rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm">
              <option value="all">Fixed & hourly</option>
              <option value="fixed">Fixed price</option>
              <option value="hourly">Hourly</option>
            </select>
            <select value={postedWithin} onChange={(e) => setPostedWithin(e.target.value as typeof postedWithin)} className="h-9 rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm">
              <option value="any">Any time</option>
              <option value="1h">Last hour</option>
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
            </select>
            {locations.length > 0 && (
              <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="h-9 rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm">
                <option value="all">All client locations</option>
                {locations.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            )}
            <input type="number" min={0} value={budgetMin} onChange={(e) => setBudgetMin(e.target.value)} placeholder="Budget min" className="h-9 w-28 rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm" />
            <input type="number" min={0} value={budgetMax} onChange={(e) => setBudgetMax(e.target.value)} placeholder="Budget max" className="h-9 w-28 rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm" />
            <input type="number" min={0} value={maxApplicants} onChange={(e) => setMaxApplicants(e.target.value)} placeholder="Max applicants" className="h-9 w-32 rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm" />
            {hasFilters && (
              <button type="button" onClick={clearFilters} className="h-9 rounded-md px-3 text-xs text-accent hover:underline">
                Clear filters
              </button>
            )}
            <span className="text-xs text-ink/40">
              {sorted.length} of {allJobs.length} shown
            </span>
          </div>
        )}
      </SectionCard>

      {jobsQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
      {jobsQuery.error && <p className="text-sm text-bad">{(jobsQuery.error as Error).message}</p>}

      {jobs && (
        <>
          <KpiStrip>
            <StatTile label="Total matching (Upwork's full catalog)" value={jobs.totalCount ?? "—"} />
            <StatTile label="Posted in last 15 min (this page)" value={justPosted.length} />
            <StatTile label="Loaded this page" value={allJobs.length} />
            <StatTile label="Applied (this page)" value={appliedCount} />
          </KpiStrip>

          {justPosted.length > 0 && (
            <SectionCard title={`Posted in the last ${JUST_POSTED_WINDOW_MIN} minutes`}>
              <div className="flex flex-col gap-2">
                {justPosted.map((job) => (
                  <JobRow key={job.id} job={job} profiles={activeProfiles} onOpen={() => setOpenJobId(job.id)} />
                ))}
              </div>
            </SectionCard>
          )}

          {groups.map(({ niche, jobs: groupJobs }) => (
            <SectionCard key={niche} title={niche}>
              <div className="flex flex-col gap-2">
                {groupJobs.map((job) => (
                  <JobRow key={job.id} job={job} profiles={activeProfiles} onOpen={() => setOpenJobId(job.id)} />
                ))}
              </div>
            </SectionCard>
          ))}

          {sorted.length === 0 && (
            <SectionCard title="Results">
              <p className="text-sm text-ink/55">No jobs match this search/filters.</p>
            </SectionCard>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line)] px-3.5 py-2.5">
            <span className="text-xs text-ink/50">Page {pageIndex + 1} · {allJobs.length} loaded</span>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-ink/55">
                Rows per page
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    resetPaging();
                  }}
                  className="h-8 rounded-md border border-[var(--line)] bg-transparent px-2 text-xs"
                >
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" disabled={pageIndex === 0} onClick={goPrevious} className="h-8 rounded-md border border-[var(--line)] px-3 text-xs disabled:opacity-40">
                Previous
              </button>
              <button type="button" disabled={!jobs.pageInfo.hasNextPage} onClick={goNext} className="h-8 rounded-md border border-[var(--line)] px-3 text-xs disabled:opacity-40">
                Next
              </button>
            </div>
          </div>
        </>
      )}

      <Modal open={Boolean(openJob)} onOpenChange={(open) => !open && setOpenJobId(null)} variant="drawer-right" title={openJob?.title ?? "Job"} contentClassName="w-full max-w-xl">
        {openJob && <JobDetail job={openJob} profiles={activeProfiles} />}
      </Modal>
    </div>
  );
}
