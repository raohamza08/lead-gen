import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { UpworkJobFetcherService } from "./job-fetcher.service";
import { GeminiClient } from "./gemini.client";
import { ProposalWritingSettingsService } from "./proposal-writing-settings.service";
import { FreelancerProfilesService } from "./freelancer-profiles.service";
import {
  computeSpendTier,
  isExcludedCountry,
  isLongTermJob,
  minutesSincePosted,
  parseFirstInt,
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
- "coverLetter": the actual Upwork cover letter text, ready to paste as-is — no markdown formatting, no placeholder brackets like [Your Name].`;
}

function buildSystemPrompt(
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
  );

  lines.push("", "Full job description:", job.description ?? "(none)");
  return lines.join("\n");
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

  async generate(orgId: string, userId: string, jobUrl: string) {
    const job = await this.jobFetcher.fetchJob(jobUrl);

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

    // Bidding SOP signals — computed here, not by the model (see
    // bidding-criteria.util.ts's own docblock for why).
    const totalSpentUsd = parseMoney(job.client?.["Total spent"]);
    const totalHires = parseFirstInt(job.client?.["Hires"]);
    const spendTier = computeSpendTier(totalSpentUsd, totalHires);
    const clientCountry = job.client?.["Country"];
    const excludedCountry = isExcludedCountry(clientCountry, settings.excludedCountries);
    const longTerm = isLongTermJob(job.facts ?? {});
    const postedMinutesAgo = minutesSincePosted(job.postedAt);
    const bidSuggestion = suggestBidAmount(job.facts ?? {});

    const warnings: string[] = [];
    if (excludedCountry) {
      warnings.push(`Client is based in ${clientCountry}, which is on your excluded-countries list.`);
    }
    if (postedMinutesAgo !== null && postedMinutesAgo > 10) {
      warnings.push(`Posted ${postedMinutesAgo} minutes ago — outside the 10-minute bidding window.`);
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
    });
    const result = await this.gemini.generateCoverLetter(systemPrompt, jobBrief);

    const draft = await this.prisma.upworkProposalDraft.create({
      data: {
        orgId,
        createdByUserId: userId,
        jobUrl,
        jobTitle: job.title,
        jobDescription: job.description,
        clientInfo: job.client ?? {},
        clientNeeds: result.clientNeeds,
        niche: result.niche,
        coverLetter: result.coverLetter,
        jobType: result.jobType,
        suggestedProfile: result.suggestedProfile,
        profileReason: result.profileReason,
        suggestedBidAmount: bidSuggestion,
        spendTier,
        isLongTerm: longTerm,
        postedMinutesAgo,
        warnings,
        overallAssessment: result.overallAssessment,
        fetchStatus: "SUCCESS",
      },
    });

    return {
      draftId: draft.id,
      fetchStatus: draft.fetchStatus,
      jobTitle: job.title,
      jobUrl: draft.jobUrl,
      clientNeeds: result.clientNeeds,
      niche: result.niche,
      coverLetter: result.coverLetter,
      jobType: result.jobType,
      suggestedProfile: result.suggestedProfile,
      profileReason: result.profileReason,
      suggestedBidAmount: bidSuggestion,
      spendTier,
      isLongTerm: longTerm,
      postedMinutesAgo,
      warnings,
      overallAssessment: result.overallAssessment,
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
