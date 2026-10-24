import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { GeminiClient } from "./gemini.client";
import { ProposalWritingSettingsService } from "./proposal-writing-settings.service";
import { FreelancerProfilesService } from "./freelancer-profiles.service";
import { buildSystemPrompt } from "./proposal-writing.service";

/// Invite content arrives as one freeform pasted blob (the client's
/// message, plus whatever job details they included), not a scraped job
/// page with labelled fields — so the brief just hands the model the raw
/// text with a note on what it is, rather than walking structured facts
/// like buildJobBrief does for a real job URL.
function buildInviteBrief(inviteText: string): string {
  return `This is the raw content of an Upwork INVITE the client sent directly — not a scraped job posting. It may mix a short personal message from the client with full or partial job details pasted together. Extract whatever job details, requirements, and context you can directly from this text; there are no separately computed bidding signals for an invite the way there are for a job URL, so base clientNeeds/niche/jobType/overallAssessment on this text alone.

Full invite content:
${inviteText}`;
}

@Injectable()
export class InviteProposalWritingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiClient,
    private readonly settingsService: ProposalWritingSettingsService,
    private readonly freelancerProfiles: FreelancerProfilesService,
  ) {}

  async generate(orgId: string, userId: string, inviteText: string, knownClientName?: string) {
    const settings = await this.settingsService.get(orgId);
    const profiles = await this.freelancerProfiles.listActive(orgId);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });

    const systemPrompt = buildSystemPrompt(
      settings.instructions,
      settings.agencyBackground,
      settings.technicalWordLimit,
      settings.nonTechnicalWordLimit,
      profiles.map((p) => ({ name: p.name, niche: p.niche })),
    );
    const result = await this.gemini.generateCoverLetter(systemPrompt, buildInviteBrief(inviteText));

    const clientName = knownClientName?.trim() || null;
    // Greeting/sign-off templated here rather than trusted to the model,
    // same reasoning as ProposalWritingService.generate.
    const coverLetter = `Hi ${clientName || "there"},\n\n${result.coverLetter.trim()}\n\nThank you,`;

    const draft = await this.prisma.upworkInviteProposalDraft.create({
      data: {
        orgId,
        createdByUserId: userId,
        createdByName: user?.name,
        inviteText,
        clientName,
        clientNeeds: result.clientNeeds,
        niche: result.niche,
        coverLetter,
        jobType: result.jobType,
        suggestedProfile: result.suggestedProfile,
        profileReason: result.profileReason,
        overallAssessment: result.overallAssessment,
      },
    });

    return {
      draftId: draft.id,
      createdByName: draft.createdByName,
      clientName,
      clientNeeds: result.clientNeeds,
      niche: result.niche,
      coverLetter,
      jobType: result.jobType,
      suggestedProfile: result.suggestedProfile,
      profileReason: result.profileReason,
      overallAssessment: result.overallAssessment,
    };
  }

  async listDrafts(orgId: string, limit = 25) {
    return this.prisma.upworkInviteProposalDraft.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
}
