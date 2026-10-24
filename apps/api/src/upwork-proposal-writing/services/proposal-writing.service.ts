import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { FetchedJob, UpworkJobFetcherService } from "./job-fetcher.service";
import { GeminiClient } from "./gemini.client";
import { ProposalWritingSettingsService } from "./proposal-writing-settings.service";
import { FreelancerProfilesService } from "./freelancer-profiles.service";
import {
  computeClientActivity,
  computeSpendTier,
  isExcludedCountry,
  isLongTermJob,
  minutesSincePosted,
  parseFirstInt,
  parseMemberSinceDate,
  parseMoney,
  suggestBidAmount,
} from "./bidding-criteria.util";

/** Fixed, structural rules that always apply regardless of what an admin
 *  edits `instructions` to — same reasoning as the JSON-output-shape
 *  instruction below: these aren't style preferences, they're the contract
 *  the rest of this service's parsing depends on, or an explicit standing
 *  decision (Part: Upwork Bidding SOP — "the bidding is not from the
 *  agency, it should be as an individual freelancer"). */
function buildStructuralRules(technicalWordLimit: number, nonTechnicalWordLimit: number): string {
  return `Write every cover letter in the voice of a single individual freelancer — use "I"/"my", never "we"/"our"/"our team". This is never written as an agency.

Do not write a greeting ("Hi ...") or a sign-off ("Thank you," / "Best," / your name, etc.) at all — those are added separately in code, around whatever you write. Write only the body text in between.

The body's very first sentence is the ONLY part of this that Upwork shows the client in their inbox preview before they open the full proposal. It must create genuine curiosity specific to THIS job — reference their actual stated problem or need — so the client is compelled to open it. Never spend it on a generic self-introduction ("I'm a developer with 5 years...") or a greeting.

Break the body into short paragraphs of 3-4 lines each, not one dense block of text.

First decide whether this job is TECHNICAL (development, data, technical writing, etc.) or NON_TECHNICAL (graphic design, simple content, data entry, and similar) and write within that type's word limit:
- TECHNICAL: up to ${technicalWordLimit} words. Focus on the client's problem, your proposed solution, relevant experience, and the expected outcome.
- NON_TECHNICAL: up to ${nonTechnicalWordLimit} words. Short, direct, personalized — and mention that relevant portfolio/reference links are attached (the actual links aren't available to you, so don't invent fake ones).
These are soft targets to write close to, not hard cutoffs enforced elsewhere.`;
}

function buildResponseSchemaInstructions(freelancerProfiles: { name: string; niche: string }[]): string {
  const profilesBlock =
    freelancerProfiles.length > 0
      ? `Available freelancer profiles to choose from:\n${freelancerProfiles.map((p) => `- ${p.name}: ${p.niche}`).join("\n")}`
      : "No freelancer profiles are configured — leave suggestedProfile and profileReason null.";

  return `${profilesBlock}

Respond with ONLY a JSON object with exactly these keys, no other text:
- "jobType": "TECHNICAL" or "NON_TECHNICAL" — your classification of this job.
- "clientNeeds": 2-4 plain-language sentences summarizing what this client actually needs, written for an internal reader deciding whether to bid — not addressed to the client.
- "niche": a short phrase (3-8 words) naming the specific niche/industry/skillset this job falls under.
- "suggestedProfile": the name of whichever configured freelancer profile best matches this job's niche, or null if none are configured or none fit reasonably.
- "profileReason": one sentence on why that profile fits (or null if suggestedProfile is null).
- "overallAssessment": 2-3 sentences answering "how good is this job to bid on" — weigh the deterministic signals given to you below (client spend tier, country, job age, long-term vs one-off) honestly; don't contradict them.
- "coverLetter": the cover letter BODY ONLY — no greeting, no sign-off (see the rules above, those are added separately), ready to paste as-is otherwise — no markdown formatting, no placeholder brackets like [Your Name]. Its first sentence must be the curiosity hook described above, and it must be broken into short 3-4 line paragraphs.`;
}

/// Exported so InviteProposalWritingService can build the same voice/
/// structural-rules/response-schema prompt for pasted invites instead of
/// duplicating it — the only thing that differs for an invite is the brief
/// (buildJobBrief vs. the invite's own, simpler brief builder), not the
/// rules the model writes under.
export function buildSystemPrompt(
  instructions: string,
  agencyBackground: string,
  technicalWordLimit: number,
  nonTechnicalWordLimit: number,
  freelancerProfiles: { name: string; niche: string }[],
): string {
  return `${buildStructuralRules(technicalWordLimit, nonTechnicalWordLimit)}

${instructions}

Freelancer background to write as (weave in naturally where relevant — don't force it, and never invent anything beyond what's here): ${agencyBackground || "(none provided)"}

${buildResponseSchemaInstructions(freelancerProfiles)}`;
}

function buildJobBrief(
  job: {
    title?: string;
    description?: string;
    postedAt?: string;
    facts?: Record<string, string>;
    skills?: string[];
    client?: Record<string, string>;
  },
  signals: {
    spendTier: string;
    isExcludedCountry: boolean;
    isLongTerm: boolean | null;
    postedMinutesAgo: number | null;
    suggestedBidAmount: string | null;
    clientActivity: string;
  },
): string {
  const lines: string[] = [];
  if (job.title) lines.push(`Job title: ${job.title}`);
  if (job.postedAt) lines.push(`Posted: ${job.postedAt}`);
  if (job.facts) Object.entries(job.facts).forEach(([label, value]) => lines.push(`${label}: ${value}`));
  if (job.skills?.length) lines.push(`Skills listed: ${job.skills.join(", ")}`);
  if (job.client && Object.keys(job.client).length) {
    lines.push("About the client:");
    Object.entries(job.client).forEach(([label, value]) => lines.push(`  ${label}: ${value}`));
  }

  lines.push(
    "",
    "Deterministic bidding signals (already computed — reference these in overallAssessment, don't recompute or contradict them):",
    `  Client spend tier: ${signals.spendTier}`,
    `  Client country excluded by our criteria: ${signals.isExcludedCountry ? "YES" : "no"}`,
    `  Long-term/ongoing work: ${signals.isLongTerm === null ? "unclear" : signals.isLongTerm ? "yes" : "no, looks short-term"}`,
    `  Minutes since posted: ${signals.postedMinutesAgo === null ? "unknown" : signals.postedMinutesAgo}`,
    `  Suggested bid: ${signals.suggestedBidAmount ?? "no budget figure found in the job facts"}`,
    `  Client activity (hires/year since joining, not "jobs posted" -- Upwork doesn't expose that): ${signals.clientActivity}`,
  );

  lines.push("", "Full job description:", job.description ?? "(none)");
  return lines.join("\n");
}

export interface ManualJobInput {
  manualTitle?: string;
  manualDescription?: string;
  manualBudget?: string;
  manualClientCountry?: string;
  manualClientTotalSpent?: string;
  manualPostedMinutesAgo?: number;
  /// Not actually a "manual job" field — the controller spreads every
  /// non-jobUrl/extractedJob DTO field into this same `manual` object (see
  /// the controller), so it lands here even though it's valid alongside an
  /// automatic or extension fetch too, not just manual entry.
  knownClientName?: string;
}

/** Builds a FetchedJob-shaped object from manually-entered fields (Part:
 *  Upwork Bidding SOP, real-world correction — Upwork's Cloudflare bot
 *  detection hard-blocks this app's VPS IP outright, confirmed by testing
 *  directly from that server; no browser-fingerprint tweak fixes an
 *  IP-reputation block). Lets generation proceed from what the user can
 *  see in their own browser instead of leaving them stuck when the
 *  automatic fetch is blocked. */
function buildManualJob(manual: ManualJobInput): FetchedJob {
  const facts: Record<string, string> = {};
  if (manual.manualBudget) facts["Budget"] = manual.manualBudget;
  const client: Record<string, string> = {};
  if (manual.manualClientCountry) client["Country"] = manual.manualClientCountry;
  if (manual.manualClientTotalSpent) client["Total spent"] = manual.manualClientTotalSpent;

  return {
    status: "SUCCESS",
    finalUrl: "",
    title: manual.manualTitle,
    description: manual.manualDescription,
    facts,
    client,
  };
}

export interface ExtractedJobInput {
  title?: string;
  description?: string;
  postedAt?: string;
  facts?: Record<string, string>;
  client?: Record<string, string>;
  skills?: string[];
}

/** Builds a FetchedJob from the browser extension's scrape (Part: Upwork
 *  Bidding SOP — the extension runs the exact same extraction logic as the
 *  (now largely bypassed) Playwright fetcher, just inside the user's own
 *  real browser, which Upwork's WAF never flags). Treated as full SUCCESS
 *  data, not a degraded fallback — it's the same fidelity a server-side
 *  fetch would have produced, just sourced differently. */
function buildExtractedJob(extracted: ExtractedJobInput): FetchedJob {
  return {
    status: "SUCCESS",
    finalUrl: "",
    title: extracted.title,
    description: extracted.description,
    postedAt: extracted.postedAt,
    facts: extracted.facts ?? {},
    client: extracted.client ?? {},
    skills: extracted.skills ?? [],
  };
}

@Injectable()
export class ProposalWritingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobFetcher: UpworkJobFetcherService,
    private readonly gemini: GeminiClient,
    private readonly settingsService: ProposalWritingSettingsService,
    private readonly freelancerProfiles: FreelancerProfilesService,
  ) {}

  /** Best-effort match against this org's own draft history to carry a
   *  known client name forward across different job postings from the
   *  same client (Part: Upwork Proposal Writing, explicit user request —
   *  "the bot should find the client name from the previous jobs that
   *  were done"). Upwork's public job page exposes no stable client ID,
   *  so this matches on the two distinguishing signals it does expose —
   *  Country + "Member since" (a specific month) — against prior drafts
   *  that already have a name recorded (which only ever got there via
   *  `knownClientName`, typed in once). Deliberately loose: a false match
   *  just resurfaces an old client's name on an unrelated client sharing
   *  the same country/join-month, not something load-bearing. */
  private async resolveClientName(orgId: string, client: Record<string, string> | undefined): Promise<string | null> {
    const country = client?.["Country"];
    const memberSince = client?.["Member since"];
    if (!country || !memberSince) return null;

    const priorNamedDrafts = await this.prisma.upworkProposalDraft.findMany({
      where: { orgId, clientName: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { clientName: true, clientInfo: true },
      take: 200,
    });

    const match = priorNamedDrafts.find((d) => {
      const info = d.clientInfo as Record<string, string> | null;
      return info?.["Country"] === country && info?.["Member since"] === memberSince;
    });
    return match?.clientName ?? null;
  }

  async generate(
    orgId: string,
    userId: string,
    jobUrl: string,
    options?: { extractedJob?: ExtractedJobInput; manual?: ManualJobInput },
  ) {
    const hasExtracted = Boolean(options?.extractedJob?.description);
    const isManual = !hasExtracted && Boolean(options?.manual?.manualDescription);
    const job = hasExtracted
      ? buildExtractedJob(options!.extractedJob!)
      : isManual
        ? buildManualJob(options!.manual!)
        : await this.jobFetcher.fetchJob(jobUrl);

    if (job.status === "FAILED") {
      // No Gemini call on a failed fetch — don't burn free-tier requests
      // generating a cover letter from job details we don't actually have.
      const draft = await this.prisma.upworkProposalDraft.create({
        data: {
          orgId,
          createdByUserId: userId,
          jobUrl,
          clientNeeds: "",
          niche: "",
          coverLetter: "",
          fetchStatus: "FAILED",
          fetchError: job.error,
        },
      });
      return { draftId: draft.id, fetchStatus: draft.fetchStatus, error: job.error };
    }

    const settings = await this.settingsService.get(orgId);
    const profiles = await this.freelancerProfiles.listActive(orgId);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });

    // Duplicate-bidding check (Part: Upwork Bidding SOP, explicit user
    // request — "if a duplicate comes up, it should highlight it") — any
    // prior successful/manual draft for this exact job, regardless of who
    // created it, so one teammate doesn't unknowingly re-bid a job another
    // already generated a letter for. Non-blocking, same "warn, don't
    // block" posture as every other criteria check here.
    const existingDraft = await this.prisma.upworkProposalDraft.findFirst({
      where: { orgId, jobUrl, fetchStatus: { in: ["SUCCESS", "PARTIAL"] } },
      orderBy: { createdAt: "desc" },
      select: { createdByName: true, createdAt: true },
    });
    const duplicateOf = existingDraft
      ? { createdByName: existingDraft.createdByName ?? "someone", createdAt: existingDraft.createdAt }
      : null;

    // Bidding SOP signals — computed here, not by the model (see
    // bidding-criteria.util.ts's own docblock for why).
    const totalSpentUsd = parseMoney(job.client?.["Total spent"]);
    const totalHires = parseFirstInt(job.client?.["Hires"]);
    const memberSinceDate = parseMemberSinceDate(job.client?.["Member since"]);
    const spendTier = computeSpendTier(totalSpentUsd, totalHires, memberSinceDate, settings.newClientWindowMonths);
    const { activity: clientActivity, monthsSinceJoined } = computeClientActivity(
      memberSinceDate,
      totalHires,
      settings.newClientWindowMonths,
      settings.minHiresPerYear,
    );
    const clientCountry = job.client?.["Country"];
    const excludedCountry = isExcludedCountry(clientCountry, settings.excludedCountries);
    const longTerm = isLongTermJob(job.facts ?? {});
    // Manual entry gives minutes-ago directly rather than a postedAt
    // timestamp to compute it from.
    const postedMinutesAgo = isManual ? options!.manual!.manualPostedMinutesAgo ?? null : minutesSincePosted(job.postedAt);
    const bidSuggestion = suggestBidAmount(job.facts ?? {});

    const warnings: string[] = [];
    if (excludedCountry) {
      warnings.push(`Client is based in ${clientCountry}, which is on your excluded-countries list.`);
    }
    if (postedMinutesAgo !== null && postedMinutesAgo > 15) {
      warnings.push(`Posted ${postedMinutesAgo} minutes ago — outside the 15-minute bidding window.`);
    }
    if (clientActivity === "LOW_ACTIVITY") {
      warnings.push(
        `Client has been on Upwork ${Math.round(monthsSinceJoined ?? 0)} months but hires rarely (~${(
          (totalHires ?? 0) / ((monthsSinceJoined ?? 1) / 12)
        ).toFixed(1)}/year) — may not have much ongoing work.`,
      );
    }

    const systemPrompt = buildSystemPrompt(
      settings.instructions,
      settings.agencyBackground,
      settings.technicalWordLimit,
      settings.nonTechnicalWordLimit,
      profiles.map((p) => ({ name: p.name, niche: p.niche })),
    );
    const jobBrief = buildJobBrief(job, {
      spendTier,
      isExcludedCountry: excludedCountry,
      isLongTerm: longTerm,
      postedMinutesAgo,
      suggestedBidAmount: bidSuggestion,
      clientActivity,
    });
    const result = await this.gemini.generateCoverLetter(systemPrompt, jobBrief);

    // Name resolution (Part: Upwork Proposal Writing, explicit user request
    // — "the bot should find the client name from the previous jobs that
    // were done"). An explicitly typed-in name always wins over the
    // heuristic match — a human-confirmed name is more trustworthy than a
    // country+join-month guess. Greeting/sign-off are templated here, not
    // trusted to the model (see buildStructuralRules).
    const knownClientName = options?.manual?.knownClientName?.trim();
    const clientName = knownClientName || (await this.resolveClientName(orgId, job.client));
    const coverLetter = `Hi ${clientName || "there"},\n\n${result.coverLetter.trim()}\n\nThank you,`;

    const draft = await this.prisma.upworkProposalDraft.create({
      data: {
        orgId,
        createdByUserId: userId,
        createdByName: user?.name,
        jobUrl,
        jobTitle: job.title,
        jobDescription: job.description,
        clientInfo: job.client ?? {},
        clientName,
        clientNeeds: result.clientNeeds,
        niche: result.niche,
        coverLetter,
        jobType: result.jobType,
        suggestedProfile: result.suggestedProfile,
        profileReason: result.profileReason,
        suggestedBidAmount: bidSuggestion,
        spendTier,
        isLongTerm: longTerm,
        postedMinutesAgo,
        clientActivity,
        monthsSinceJoined,
        warnings,
        overallAssessment: result.overallAssessment,
        // PARTIAL marks "came from manual entry, not a real automatic
        // fetch" — distinct from SUCCESS so the history list stays honest
        // about which drafts are a full scrape vs. what the user typed in
        // after Upwork blocked the fetch.
        fetchStatus: isManual ? "PARTIAL" : "SUCCESS",
      },
    });

    return {
      draftId: draft.id,
      fetchStatus: draft.fetchStatus,
      jobTitle: job.title,
      jobUrl: draft.jobUrl,
      createdByName: draft.createdByName,
      clientName,
      clientNeeds: result.clientNeeds,
      niche: result.niche,
      coverLetter,
      jobType: result.jobType,
      suggestedProfile: result.suggestedProfile,
      profileReason: result.profileReason,
      suggestedBidAmount: bidSuggestion,
      spendTier,
      isLongTerm: longTerm,
      postedMinutesAgo,
      clientActivity,
      monthsSinceJoined,
      warnings,
      overallAssessment: result.overallAssessment,
      duplicateOf,
    };
  }

  async listDrafts(orgId: string, limit = 25) {
    return this.prisma.upworkProposalDraft.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
}
