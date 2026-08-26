import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

export interface NotifyInput {
  type: string;
  severity?: "ERROR" | "WARNING";
  message: string;
  leadId?: string;
  conversationId?: string;
}

/**
 * The escalation path for "autonomous recovery could not fix this on its
 * own" — an agent-dispatch job that exhausted its retries, a pipeline that
 * hit a permanent failure. Deliberately NOT used for everyday agent activity
 * (a DEGRADED run, a normal stage transition): those already have the
 * AgentRun trail and the live event stream, and treating routine outcomes as
 * notifications would bury the ones that actually need a human.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async notify(orgId: string, input: NotifyInput) {
    const notification = await this.prisma.notification.create({
      data: {
        orgId,
        leadId: input.leadId,
        conversationId: input.conversationId,
        type: input.type,
        severity: input.severity ?? "ERROR",
        message: input.message,
      },
    });
    this.logger.warn(`[${input.type}] ${input.message}`);
    this.realtime.emitToOrg(orgId, "notification.created", notification);
    return notification;
  }

  list(orgId: string, limit = 50) {
    return this.prisma.notification.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  async markRead(orgId: string, id: string) {
    await this.prisma.notification.updateMany({ where: { id, orgId }, data: { read: true } });
    return { read: true };
  }

  async markAllRead(orgId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { orgId, read: false },
      data: { read: true },
    });
    return { updated: result.count };
  }
}
