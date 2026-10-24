import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";

/** Seeded on an org's first GET/use of this module — gives the generator
 *  something reasonable to work from before anyone has touched Settings,
 *  same "ships with a sane default, editable anytime" posture as every
 *  other configurable prompt in this app. */
const DEFAULT_INSTRUCTIONS = `Before drafting, extract from the brief: the main deliverable, the client's actual problem, the desired end result, any stated style/format/quantity/dimension requirements, the deadline, the budget, and any application instructions (required samples, screening questions, a specific opening word). Never ask the client for anything already stated in the post. Always answer every question the client explicitly asks, even if it falls outside the structure below.

Opening: reference a concrete requirement or detail from THIS brief (a problem they described, a format they need, a constraint they mentioned) — never invent a problem, a number, or a lost-revenue estimate that isn't actually in the brief. Use the client's or company's real name only when it's actually given — never guess one, never repeat it more than once or twice. Use the company name for business/B2B clients and a personal first name for individuals or solopreneurs, when that distinction is clear from the post.

Keep the whole body tight and scannable: short paragraphs, no long bio, no restating the whole job post, no software/tool laundry list, nothing added just to hit a word count, nothing already visible on the profile.

Emojis are optional and only when they fit the client's own tone — at most a handful, e.g. a few checkmarks in a short deliverables list. Never stack multiple emojis or use them for excitement/emphasis.

Order within the body: acknowledge the brief and the real concern it implies, THEN explain the approach, THEN place any proof/experience reference — proof comes after the approach is explained, not before it and not as an opening flex. Weave in two or three specific real details from the brief (not more) to show genuine understanding — never repeat the entire job post back.

When mentioning experience or a sample, reference exactly one relevant project and what was actually done on it — never a link dump, never generic "see my portfolio," never credit for work that wasn't actually part of the described background.

Include one concrete, relevant technical or process detail that shows real understanding of the deliverable — never generic jargon, and only to explain the approach, not to sound impressive. Where genuinely true, note one specific thing about how I'd handle it — never by criticizing other freelancers or claiming unsupported superior results.

If pricing or timeline is appropriate to state, tie the number directly to the scope (what's included, how many revisions, what assumptions it depends on) — never an invented ROI figure, never "my budget is flexible." If the client asks for an hourly breakdown, give one. If proposing a timeline, make it a realistic small set of concrete steps/days tied to real dependencies (e.g. "after you approve the direction," "once assets are provided") — never a bare "ASAP" and never an elaborate multi-week plan for a small task.

End with exactly one specific, easy-to-answer next step or question — the single most useful clarifying question for this job, or a concrete choice to react to. Never a generic "let's discuss," never more than one question, never a question the brief already answers. Only add a P.S. if it adds one genuinely new, truthful piece of value (never a generic "I'm hardworking and passionate" line, never reference a video or resource that doesn't actually exist).

State availability honestly and only as it actually is — never invented scarcity like "slots open" or countdowns.

Only state a guarantee (revisions included, a review step before finishing, a deadline) when it's something fully within control — never promise an outcome like sales, virality, or engagement that can't be guaranteed.

Close with calm, genuine interest in the specific work — never "my dream project," never begging, never over-the-top enthusiasm.

Proofread mentally before finalizing: no leftover placeholder text, no name or detail copied from a different job, consistent numbers and links throughout.`;

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
    input: {
      agencyBackground?: string;
      instructions?: string;
      technicalWordLimit?: number;
      nonTechnicalWordLimit?: number;
      excludedCountries?: string[];
      newClientWindowMonths?: number;
      minHiresPerYear?: number;
    },
  ) {
    await this.get(orgId); // ensure a row exists before updating it
    return this.prisma.upworkProposalWritingSettings.update({
      where: { orgId },
      data: { ...input, updatedByUserId: actorId },
    });
  }
}
