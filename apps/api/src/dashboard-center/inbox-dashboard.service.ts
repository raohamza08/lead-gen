import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { DashboardRangeQuery, resolveDashboardRange } from "./dashboard-center.util";

@Injectable()
export class InboxDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getAccounts(orgId: string, query: DashboardRangeQuery) {
    const { current } = resolveDashboardRange(query);
    const accounts = await this.prisma.emailAccount.findMany({
      where: { orgId },
      select: { id: true, address: true, mailboxLabel: true, provider: true, status: true, inboundSyncEnabled: true, suspendedAt: true },
    });

    return Promise.all(
      accounts.map(async (a) => {
        const [received, sent, unread, threads] = await Promise.all([
          this.prisma.inboundEmailMessage.count({ where: { accountId: a.id, receivedAt: { gte: current.from, lte: current.to } } }),
          this.prisma.emailMessage.count({ where: { sentAt: { gte: current.from, lte: current.to } } }),
          this.prisma.inboundEmailMessage.count({ where: { accountId: a.id, isRead: false, isIgnored: false } }),
          this.prisma.inboundEmailThread.count({ where: { accountId: a.id, lastMessageAt: { gte: current.from, lte: current.to } } }),
        ]);
        return {
          id: a.id,
          address: a.address,
          label: a.mailboxLabel,
          provider: a.provider,
          // A suspended/inactive account's "0 received" must read as a sync
          // problem, not an honestly-quiet inbox (Part: spec section 26 —
          // "0 records" vs "integration not connected").
          status: a.suspendedAt ? "SUSPENDED" : a.inboundSyncEnabled ? a.status : "SYNC_DISABLED",
          received,
          sent,
          unread,
          threads,
        };
      }),
    );
  }

  async getVolume(orgId: string, query: DashboardRangeQuery) {
    const { current } = resolveDashboardRange(query);
    const accountIds = (await this.prisma.emailAccount.findMany({ where: { orgId }, select: { id: true } })).map((a) => a.id);

    const [received, sent, unread] = await Promise.all([
      this.prisma.inboundEmailMessage.count({ where: { accountId: { in: accountIds }, receivedAt: { gte: current.from, lte: current.to } } }),
      this.prisma.emailMessage.count({ where: { sentAt: { gte: current.from, lte: current.to }, lead: { orgId } } }),
      this.prisma.inboundEmailMessage.count({ where: { accountId: { in: accountIds }, isRead: false, isIgnored: false } }),
    ]);

    return { received, sent, unread };
  }

  /** Leads that came in via a reply/thread that got linked to a real Lead
   *  row -- InboundEmailThread.leadId is the real, honest signal here.
   *  There is no separate "website form" concept in the schema (Part:
   *  Dashboard Center gap-analysis) -- a contact-form email is
   *  indistinguishable from any other inbound lead-candidate email today,
   *  so this reports "leads created from inbound email" generally rather
   *  than fabricating a form-specific breakdown. */
  async getLeadsFromEmail(orgId: string, query: DashboardRangeQuery) {
    const { current } = resolveDashboardRange(query);
    const threads = await this.prisma.inboundEmailThread.findMany({
      where: { orgId, leadId: { not: null }, lastMessageAt: { gte: current.from, lte: current.to } },
      select: { id: true, subject: true, leadId: true, lastMessageAt: true, account: { select: { address: true } } },
      orderBy: { lastMessageAt: "desc" },
      take: 100,
    });
    return threads.map((t) => ({ threadId: t.id, subject: t.subject, leadId: t.leadId, account: t.account.address, date: t.lastMessageAt }));
  }
}
