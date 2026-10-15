import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";

/** Seeded on an org's first GET/use of this module — gives the generator
 *  something reasonable to work from before anyone has touched Settings,
 *  same "ships with a sane default, editable anytime" posture as every
 *  other configurable prompt in this app. */
const DEFAULT_INSTRUCTIONS = `Write in a confident, warm, concise tone — never generic or robotic.
Open by referencing something specific from this job post, not a generic greeting.
Get straight to how we'd approach their specific need instead of restating the job post back at them.
Avoid clichés like "I am excited to apply" or "I have carefully read your job posting".
No filler, no generic agency boilerplate, no claiming experience/clients/numbers that aren't in the agency background below.
End with a simple, low-pressure call to action (e.g. offering a quick call or a couple of clarifying questions), not a hard sell.`;

@Injectable()
export class ProposalWritingSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(orgId: string) {
    const existing = await this.prisma.upworkProposalWritingSettings.findUnique({ where: { orgId } });
    if (existing) return existing;
    return this.prisma.upworkProposalWritingSettings.create({
      data: { orgId, instructions: DEFAULT_INSTRUCTIONS },
    });
  }

  async update(
    orgId: string,
    actorId: string,
    input: { agencyBackground?: string; instructions?: string; wordCountTarget?: number },
  ) {
    await this.get(orgId); // ensure a row exists before updating it
    return this.prisma.upworkProposalWritingSettings.update({
      where: { orgId },
      data: { ...input, updatedByUserId: actorId },
    });
  }
}
