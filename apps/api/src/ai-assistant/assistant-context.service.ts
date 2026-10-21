import { Injectable } from "@nestjs/common";
import { JwtClaims, Role } from "@leadgen/types";
import { PrismaService } from "../common/prisma/prisma.service";
import { UserAccessCacheService } from "../common/access/user-access-cache.service";
import { EmailHubService } from "../email-hub/email-hub.service";
import { SocialInboxService } from "../social-media/social-inbox.service";
import { SearchService } from "../search/search.service";

const SINCE_DAYS = 7;

/**
 * Assembles the permission-filtered context string the AI chat assistant is
 * grounded in (Part: AI chat assistant, 2026-10-21) — deliberately plain
 * counts/stats, not a dynamic query the LLM itself constructs (see the
 * search/AI-assistant plan's "no dynamic SQL" scope decision: this closes
 * off prompt-injection-via-generated-query risk entirely by keeping every
 * query deterministic and server-authored). Each section only appears if
 * the user's own module-access flags already permit it — the same cached
 * flags `ModuleAccessGuard`/`SearchService` read, not a fresh check.
 */
@Injectable()
export class AssistantContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userAccess: UserAccessCacheService,
    private readonly emailHub: EmailHubService,
    private readonly socialInbox: SocialInboxService,
    private readonly search: SearchService,
  ) {}

  async build(user: JwtClaims, question: string): Promise<string> {
    const access = await this.userAccess.get(user.sub);
    const isAdmin = user.role === Role.ADMIN;
    const granted = (...fields: (keyof NonNullable<typeof access>)[]) => isAdmin || fields.some((f) => Boolean(access?.[f]));

    const sections: string[] = [];

    if (granted("leadGenAccess")) sections.push(await this.leadsSection(user.orgId));
    if (granted("emailHubAccess")) sections.push(await this.emailSection(user));
    if (granted("socialMediaAccess")) sections.push(await this.socialSection(user));
    if (granted("upworkBiddingAccess", "upworkInviteAccess")) sections.push(await this.upworkSection(user.orgId));

    // Literal-match grounding for the specific question asked, reusing the
    // same gated search already built for the search bar rather than a
    // second, separate implementation.
    const hits = await this.search.search(user, question);
    const hitLines = this.formatHits(hits);
    if (hitLines) sections.push(hitLines);

    return sections.filter(Boolean).join("\n\n");
  }

  private since(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  private async leadsSection(orgId: string): Promise<string> {
    const [total, recent, awaitingPromotion] = await Promise.all([
      this.prisma.lead.count({ where: { orgId } }),
      this.prisma.lead.count({ where: { orgId, createdAt: { gte: this.since(SINCE_DAYS) } } }),
      this.prisma.lead.count({ where: { orgId, pipelineState: null } }),
    ]);
    return [
      "LEADS:",
      `- Total leads: ${total}`,
      `- New in the last ${SINCE_DAYS} days: ${recent}`,
      `- Awaiting promotion to pipeline (Lead Room): ${awaitingPromotion}`,
    ].join("\n");
  }

  private async emailSection(user: JwtClaims): Promise<string> {
    const stats = (await this.emailHub.getStats(user)) as Record<string, number>;
    return [
      "EMAIL HUB:",
      `- Unread: ${stats.unread ?? 0}`,
      `- Important: ${stats.important ?? 0}`,
      `- Received today: ${stats.receivedToday ?? 0}`,
      `- Received this week: ${stats.receivedThisWeek ?? 0}`,
      `- Ignored: ${stats.ignored ?? 0}`,
    ].join("\n");
  }

  private async socialSection(user: JwtClaims): Promise<string> {
    const stats = (await this.socialInbox.getStats(user)) as {
      total?: number;
      unread?: number;
      open?: number;
      pending?: number;
      closed?: number;
      byPlatform?: Record<string, number>;
    };
    const byPlatform = stats.byPlatform
      ? Object.entries(stats.byPlatform)
          .map(([platform, count]) => `${platform}: ${count}`)
          .join(", ")
      : "none";
    return [
      "SOCIAL MEDIA INBOX:",
      `- Total conversations: ${stats.total ?? 0}`,
      `- Unread: ${stats.unread ?? 0}`,
      `- Open / pending / closed: ${stats.open ?? 0} / ${stats.pending ?? 0} / ${stats.closed ?? 0}`,
      `- Unread by platform: ${byPlatform}`,
    ].join("\n");
  }

  private async upworkSection(orgId: string): Promise<string> {
    const [total, recent, won, lost] = await Promise.all([
      this.prisma.upworkProposal.count({ where: { orgId } }),
      this.prisma.upworkProposal.count({ where: { orgId, createdAt: { gte: this.since(SINCE_DAYS) } } }),
      this.prisma.upworkProposal.count({ where: { orgId, status: "WON" } }),
      this.prisma.upworkProposal.count({ where: { orgId, status: "LOST" } }),
    ]);
    return [
      "UPWORK PROPOSALS:",
      `- Total submitted: ${total}`,
      `- Submitted in the last ${SINCE_DAYS} days: ${recent}`,
      `- Won: ${won}`,
      `- Lost: ${lost}`,
    ].join("\n");
  }

  private formatHits(hits: Awaited<ReturnType<SearchService["search"]>>): string {
    const lines: string[] = [];
    const add = (label: string, items: { title: string; subtitle?: string }[]) => {
      if (!items.length) return;
      lines.push(`${label}:`);
      for (const item of items) lines.push(`- ${item.title}${item.subtitle ? ` (${item.subtitle})` : ""}`);
    };
    add("MATCHING LEADS", hits.leads);
    add("MATCHING EMAILS", hits.emails);
    add("MATCHING SOCIAL CONVERSATIONS", hits.social);
    add("MATCHING UPWORK PROPOSALS", hits.upwork);
    return lines.length ? `SPECIFIC MATCHES FOR THIS QUESTION:\n${lines.join("\n")}` : "";
  }
}
