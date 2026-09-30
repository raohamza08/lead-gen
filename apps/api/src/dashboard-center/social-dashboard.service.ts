import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { DashboardRangeQuery, resolveDashboardRange, safeRate } from "./dashboard-center.util";

function averageMinutes(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

@Injectable()
export class SocialDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** Response time is computed here, not stored -- first inbound message's
   *  timestamp to the first outbound reply after it, per conversation (Part:
   *  Dashboard Center gap-analysis confirmed this is honestly computable
   *  from SocialMessage.sentAt/fromUs, just not pre-aggregated anywhere). */
  private async responseTimesFor(conversationIds: string[]): Promise<{ conversationId: string; minutes: number | undefined }[]> {
    if (conversationIds.length === 0) return [];
    const messages = await this.prisma.socialMessage.findMany({
      where: { conversationId: { in: conversationIds } },
      orderBy: { sentAt: "asc" },
      select: { conversationId: true, fromUs: true, sentAt: true },
    });
    const byConversation = new Map<string, typeof messages>();
    for (const m of messages) {
      const bucket = byConversation.get(m.conversationId) ?? [];
      bucket.push(m);
      byConversation.set(m.conversationId, bucket);
    }
    return [...byConversation.entries()].map(([conversationId, msgs]) => {
      const firstInbound = msgs.find((m) => !m.fromUs);
      if (!firstInbound) return { conversationId, minutes: undefined };
      const firstReply = msgs.find((m) => m.fromUs && m.sentAt > firstInbound.sentAt);
      if (!firstReply) return { conversationId, minutes: undefined };
      return { conversationId, minutes: (firstReply.sentAt.getTime() - firstInbound.sentAt.getTime()) / 60000 };
    });
  }

  async getKpis(orgId: string, query: DashboardRangeQuery) {
    const { current } = resolveDashboardRange(query);
    const where = { socialAccount: { orgId }, lastMessageAt: { gte: current.from, lte: current.to } };

    // ConversationStatus has no distinct "replied" state -- CLOSED is used
    // as the closest real proxy for "handled," not a fabricated category.
    const [total, unread, replied, pending, conversationIds] = await Promise.all([
      this.prisma.socialConversation.count({ where }),
      this.prisma.socialConversation.count({ where: { ...where, unreadCount: { gt: 0 } } }),
      this.prisma.socialConversation.count({ where: { ...where, status: "CLOSED" } }),
      this.prisma.socialConversation.count({ where: { ...where, status: { in: ["OPEN", "PENDING"] } } }),
      this.prisma.socialConversation.findMany({ where, select: { id: true }, take: 500 }).then((r) => r.map((c) => c.id)),
    ]);

    const times = await this.responseTimesFor(conversationIds);
    const answered = times.filter((t) => t.minutes !== undefined);

    return {
      range: { from: current.from, to: current.to },
      totalConversations: total,
      unreadConversations: unread,
      repliedConversations: replied,
      pendingConversations: pending,
      responseRate: safeRate(answered.length, times.length),
      avgResponseMinutes: averageMinutes(answered.map((t) => t.minutes!)),
      // No CRM lead linkage exists from a social conversation anywhere in
      // the schema (Part: Dashboard Center gap-analysis — confirmed via the
      // Social Hub's own "deliberately no lead/CRM linkage" comment). The
      // spec's "message -> lead -> client" funnel genuinely can't be built
      // today; reported honestly as unavailable rather than guessed.
      leadConversionAvailable: false,
    };
  }

  async getPlatformBreakdown(orgId: string, query: DashboardRangeQuery) {
    const { current } = resolveDashboardRange(query);
    const accounts = await this.prisma.socialAccount.findMany({ where: { orgId }, select: { id: true, platform: true, username: true } });

    return Promise.all(
      accounts.map(async (a) => {
        const [conversations, newConversations, unread, messagesIn, messagesOut] = await Promise.all([
          this.prisma.socialConversation.count({ where: { socialAccountId: a.id } }),
          this.prisma.socialConversation.count({ where: { socialAccountId: a.id, createdAt: { gte: current.from, lte: current.to } } }),
          this.prisma.socialConversation.count({ where: { socialAccountId: a.id, unreadCount: { gt: 0 } } }),
          this.prisma.socialMessage.count({ where: { conversation: { socialAccountId: a.id }, fromUs: false, sentAt: { gte: current.from, lte: current.to } } }),
          this.prisma.socialMessage.count({ where: { conversation: { socialAccountId: a.id }, fromUs: true, sentAt: { gte: current.from, lte: current.to } } }),
        ]);
        return { accountId: a.id, platform: a.platform, username: a.username, conversations, newConversations, unread, messagesIn, messagesOut };
      }),
    );
  }

  async getTeamResponseMetrics(orgId: string, query: DashboardRangeQuery) {
    const { current } = resolveDashboardRange(query);
    const conversations = await this.prisma.socialConversation.findMany({
      where: { socialAccount: { orgId }, assignedToUserId: { not: null }, lastMessageAt: { gte: current.from, lte: current.to } },
      select: { id: true, assignedToUserId: true, assignedToUser: { select: { name: true } } },
    });

    const byUser = new Map<string, { userId: string; name: string; conversationIds: string[] }>();
    for (const c of conversations) {
      const bucket = byUser.get(c.assignedToUserId!) ?? { userId: c.assignedToUserId!, name: c.assignedToUser!.name, conversationIds: [] };
      bucket.conversationIds.push(c.id);
      byUser.set(c.assignedToUserId!, bucket);
    }

    return Promise.all(
      [...byUser.values()].map(async (u) => {
        const times = await this.responseTimesFor(u.conversationIds);
        const answered = times.filter((t) => t.minutes !== undefined);
        return {
          userId: u.userId,
          name: u.name,
          conversationsHandled: u.conversationIds.length,
          avgResponseMinutes: averageMinutes(answered.map((t) => t.minutes!)),
        };
      }),
    );
  }
}
