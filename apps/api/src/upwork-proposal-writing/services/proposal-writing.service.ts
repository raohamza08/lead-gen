import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { UpworkJobFetcherService } from "./job-fetcher.service";
import { OpenAiClient } from "./openai.client";
import { ProposalWritingSettingsService } from "./proposal-writing-settings.service";

function buildSystemPrompt(instructions: string, agencyBackground: string, wordCountTarget: number): string {
  return `${instructions}

Agency/freelancer background to write as (weave in naturally where relevant — don't force it, and never invent anything beyond what's here): ${agencyBackground || "(none provided)"}

Target length for the cover letter: around ${wordCountTarget} words.

Respond with ONLY a JSON object with exactly these three keys, no other text:
- "clientNeeds": 2-4 plain-language sentences summarizing what this client actually needs, written for an internal reader deciding whether to bid — not addressed to the client.
- "niche": a short phrase (3-8 words) naming the specific niche/industry/skillset this job falls under.
- "coverLetter": the actual Upwork cover letter text, ready to paste as-is — no markdown formatting, no placeholder brackets like [Your Name].`;
}

function buildJobBrief(job: {
  title?: string;
  description?: string;
  postedAt?: string;
  facts?: Record<string, string>;
  skills?: string[];
  client?: Record<string, string>;
}): string {
  const lines: string[] = [];
  if (job.title) lines.push(`Job title: ${job.title}`);
  if (job.postedAt) lines.push(`Posted: ${job.postedAt}`);
  if (job.facts) Object.entries(job.facts).forEach(([label, value]) => lines.push(`${label}: ${value}`));
  if (job.skills?.length) lines.push(`Skills listed: ${job.skills.join(", ")}`);
  if (job.client && Object.keys(job.client).length) {
    lines.push("About the client:");
    Object.entries(job.client).forEach(([label, value]) => lines.push(`  ${label}: ${value}`));
  }
  lines.push("", "Full job description:", job.description ?? "(none)");
  return lines.join("\n");
}

@Injectable()
export class ProposalWritingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobFetcher: UpworkJobFetcherService,
    private readonly openAi: OpenAiClient,
    private readonly settingsService: ProposalWritingSettingsService,
  ) {}

  async generate(orgId: string, userId: string, jobUrl: string) {
    const job = await this.jobFetcher.fetchJob(jobUrl);

    if (job.status === "FAILED") {
      // No OpenAI call on a failed fetch — don't spend tokens generating a
      // cover letter from job details we don't actually have.
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
    const systemPrompt = buildSystemPrompt(settings.instructions, settings.agencyBackground, settings.wordCountTarget);
    const jobBrief = buildJobBrief(job);
    const result = await this.openAi.generateCoverLetter(systemPrompt, jobBrief);

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
