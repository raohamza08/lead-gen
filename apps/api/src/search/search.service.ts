import { Injectable } from "@nestjs/common";
import { JwtClaims, Role } from "@leadgen/types";
import { UserAccessCacheService } from "../common/access/user-access-cache.service";
import { LeadsService } from "../leads/leads.service";
import { EmailHubService } from "../email-hub/email-hub.service";
import { SocialInboxService } from "../social-media/social-inbox.service";
import { UpworkService } from "../upwork/upwork.service";

export interface SearchResultItem {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

export interface SearchResults {
  leads: SearchResultItem[];
  emails: SearchResultItem[];
  social: SearchResultItem[];
  upwork: SearchResultItem[];
}

const PAGE_SIZE = 5;

/**
 * Cross-module search (Part: global search, 2026-10-21) — fans out to each
 * module's own existing search-capable list method rather than building a
 * bespoke search index. Every source is individually gated by the same
 * cached per-module access flags `ModuleAccessGuard` reads (not a new flag
 * of its own) — a user without e.g. Social Media access gets no social
 * results here either, same as they'd get none navigating there directly.
 * Campaigns/Meta Ads have no existing search method to reuse and are
 * explicitly out of scope for this pass.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly userAccess: UserAccessCacheService,
    private readonly leadsService: LeadsService,
    private readonly emailHub: EmailHubService,
    private readonly socialInbox: SocialInboxService,
    private readonly upwork: UpworkService,
  ) {}

  async search(user: JwtClaims, q: string): Promise<SearchResults> {
    const access = await this.userAccess.get(user.sub);
    const isAdmin = user.role === Role.ADMIN;
    const granted = (...fields: (keyof NonNullable<typeof access>)[]) => isAdmin || fields.some((f) => Boolean(access?.[f]));

    const [leads, emails, social, upwork] = await Promise.all([
      granted("leadGenAccess") ? this.searchLeads(user, q) : Promise.resolve([]),
      granted("emailHubAccess") ? this.searchEmails(user, q) : Promise.resolve([]),
      granted("socialMediaAccess") ? this.searchSocial(user, q) : Promise.resolve([]),
      // Mirrors the nav's own visibility rule for these results (Upwork
      // Proposals has no single blanket flag — Bidding/Invite are each
      // gated independently, see sidebar-nav.tsx's MODULE_FLAG_BY_GROUP).
      granted("upworkBiddingAccess", "upworkInviteAccess") ? this.searchUpwork(user, q) : Promise.resolve([]),
    ]);

    return { leads, emails, social, upwork };
  }

  private async searchLeads(user: JwtClaims, q: string): Promise<SearchResultItem[]> {
    const { items } = await this.leadsService.findAll(user.orgId, { search: q, page: 1, pageSize: PAGE_SIZE });
    return items.map((lead) => ({
      id: lead.id,
      title: lead.companyName || lead.contactName || lead.email || "Lead",
      subtitle: lead.companyName && lead.contactName ? lead.contactName : (lead.email ?? undefined),
      href: `/leads/${lead.id}`,
    }));
  }

  private async searchEmails(user: JwtClaims, q: string): Promise<SearchResultItem[]> {
    const { messages } = await this.emailHub.listMessages(user, { search: q, page: 1, pageSize: PAGE_SIZE });
    return messages.map((message) => ({
      id: message.id,
      title: message.subject || "(no subject)",
      subtitle: message.fromName || message.fromEmail,
      // Email Hub has no per-message deep-link route today — land on the
      // section's own landing page rather than inventing one.
      href: "/email-hub",
    }));
  }

  private async searchSocial(user: JwtClaims, q: string): Promise<SearchResultItem[]> {
    const { conversations } = await this.socialInbox.listConversations(user, { search: q, page: 1, pageSize: PAGE_SIZE });
    return conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.contactName || conversation.contactUsername || "Conversation",
      subtitle: conversation.lastMessage ?? undefined,
      href: `/social-media/${conversation.socialAccount.platform.toLowerCase()}`,
    }));
  }

  private async searchUpwork(user: JwtClaims, q: string): Promise<SearchResultItem[]> {
    const { items } = await this.upwork.findAll(user.orgId, { search: q, page: "1", pageSize: String(PAGE_SIZE) });
    return items.map((proposal) => ({
      id: proposal.id,
      title: proposal.clientName || "Proposal",
      subtitle: proposal.submittedBy ?? undefined,
      href: proposal.type === "INVITE" ? "/upwork/invite" : "/upwork/bidding",
    }));
  }
}
