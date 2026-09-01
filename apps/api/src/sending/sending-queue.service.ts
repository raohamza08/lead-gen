import { Injectable, Logger } from "@nestjs/common";
import { NotificationCategory } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { NotificationsService } from "../notifications/notifications.service";
import { EmailProviderService } from "../email/email-provider.service";
import { SendingQueue } from "./sending-queue.queue";
import { nextDailyFireAfter, oneTimeFireDate } from "./schedule-time";

/**
 * The single entry point a now-fully-prepared EmailMessage passes through
 * before it's ever handed to SendingWorker (Part: Preparation Pipeline /
 * Sending Queue, 2026-09-01) — called only from
 * PreparationPipelineService.evaluate() once every required agent for that
 * step has SUCCEEDED. Reads the org's SendingSchedule directly (rather than
 * asking SendingSchedulerService) so there's no dependency back on the
 * service that itself depends on this one to fire a batch.
 */
@Injectable()
export class SendingQueueService {
  private readonly logger = new Logger(SendingQueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
    private readonly emailProvider: EmailProviderService,
    private readonly sendingQueue: SendingQueue,
  ) {}

  /**
   * Rule #1/#4 from the spec: Ready means prepared, not sent. No schedule
   * configured (or disabled) -> release immediately. A schedule enabled ->
   * park the message at WAITING_FOR_SCHEDULE with a computed `scheduledAt`
   * (display-only estimate — the real fire moment is SendingSchedulerService's
   * CronJob) until the scheduler's next fire sweeps it into a SendingSession.
   */
  async enqueue(orgId: string, emailMessageId: string): Promise<void> {
    const schedule = await this.prisma.sendingSchedule.findUnique({ where: { orgId } });
    if (!schedule?.enabled) {
      await this.releaseNow(orgId, emailMessageId, null);
      return;
    }

    let scheduledAt: Date | null = null;
    try {
      scheduledAt =
        schedule.frequency === "ONE_TIME"
          ? schedule.oneTimeDate
            ? oneTimeFireDate(schedule.oneTimeDate, schedule.sendTime, schedule.timezone)
            : null
          : nextDailyFireAfter(new Date(), schedule.sendTime, schedule.timezone);
    } catch (err) {
      this.logger.warn(`Could not compute schedule time for org ${orgId}: ${(err as Error).message}`);
    }

    if (!scheduledAt) {
      // A misconfigured/expired schedule must never silently strand a
      // fully-prepared message — fail open to immediate sending.
      await this.releaseNow(orgId, emailMessageId, null);
      return;
    }

    await this.prisma.emailMessage.update({
      where: { id: emailMessageId },
      data: { status: "WAITING_FOR_SCHEDULE", scheduledAt },
    });
    this.realtime.emitToOrg(orgId, "sendingQueue.updated", {
      emailMessageId,
      status: "WAITING_FOR_SCHEDULE",
      scheduledAt: scheduledAt.toISOString(),
    });
  }

  private async releaseNow(orgId: string, emailMessageId: string, sendingSessionId: string | null) {
    await this.prisma.emailMessage.update({
      where: { id: emailMessageId },
      data: { status: "READY_TO_SEND", scheduledAt: null, sendingSessionId },
    });
    this.realtime.emitToOrg(orgId, "sendingQueue.updated", { emailMessageId, status: "READY_TO_SEND" });
    await this.sendingQueue.add({ emailMessageId });
  }

  /**
   * Called by SendingSchedulerService when an org's cron fires. Sweeps up
   * every WAITING_FOR_SCHEDULE message regardless of when each one finished
   * preparation (rule #4), splitting into a capacity-sized SendingSession —
   * requirement #5's "large batches must be split according to real
   * provider/API throughput limits." Overflow beyond today's capacity is
   * left untouched at WAITING_FOR_SCHEDULE (picked up whole again by
   * tomorrow's DAILY fire, which recomputes capacity fresh) rather than
   * dropped — a ONE_TIME schedule has no "tomorrow," so overflow there is
   * surfaced as an explicit notification instead of silently vanishing.
   */
  async fire(orgId: string): Promise<void> {
    const eligible = await this.prisma.emailMessage.findMany({
      where: { status: "WAITING_FOR_SCHEDULE", lead: { orgId } },
      orderBy: { scheduledAt: "asc" },
    });
    if (eligible.length === 0) return;

    const capacity = await this.emailProvider.getDailyCapacity(orgId);
    if (capacity <= 0) {
      await this.notifications.notify(orgId, {
        category: NotificationCategory.EMAIL,
        type: "SENDING_CAPACITY_EXHAUSTED",
        severity: "WARNING",
        title: "Sending Deferred",
        message: `${eligible.length} email(s) are ready to send but no sending-enabled mailbox has capacity today — they'll go out on the next scheduled run.`,
        actionUrl: "/settings",
      });
      return;
    }

    const batch = eligible.slice(0, capacity);
    const deferred = eligible.length - batch.length;

    const session = await this.prisma.sendingSession.create({
      data: { orgId, status: "PROCESSING", startedAt: new Date(), totalLeads: batch.length },
    });
    await this.prisma.emailMessage.updateMany({
      where: { id: { in: batch.map((m) => m.id) } },
      data: { status: "READY_TO_SEND", scheduledAt: null, sendingSessionId: session.id },
    });
    for (const message of batch) {
      await this.sendingQueue.add({ emailMessageId: message.id });
    }
    this.realtime.emitToOrg(orgId, "sendingSession.updated", {
      sendingSessionId: session.id,
      status: "PROCESSING",
      totalLeads: batch.length,
      successful: 0,
      failed: 0,
    });

    if (deferred > 0) {
      this.logger.warn(`Sending schedule for org ${orgId}: ${deferred} message(s) exceeded today's capacity, deferred`);
      await this.notifications.notify(orgId, {
        category: NotificationCategory.EMAIL,
        type: "SENDING_CAPACITY_EXCEEDED",
        severity: "WARNING",
        title: "Sending Batch Split",
        message: `${batch.length} email(s) are sending now; ${deferred} more exceeded today's mailbox capacity and will go out on the next scheduled run.`,
        actionUrl: "/settings",
      });
    }
  }

  /**
   * Counts backing the Automation page's Preparation & Sending dashboard
   * (Part: Preparation Pipeline / Sending Queue, 2026-09-01) — aggregate
   * queries, not the raw rows, since the dashboard only needs "how many,"
   * plus the small list of currently-active SendingSessions for their
   * progress bars.
   */
  async getDashboard(orgId: string) {
    const [preparationCounts, sendingCounts, activeSessions] = await Promise.all([
      this.prisma.pipelineState.groupBy({
        by: ["preparationStatus"],
        where: { lead: { orgId } },
        _count: { _all: true },
      }),
      this.prisma.emailMessage.groupBy({
        by: ["status"],
        where: {
          lead: { orgId },
          status: { in: ["WAITING_FOR_SCHEDULE", "READY_TO_SEND", "SENDING", "RETRY_SCHEDULED"] },
        },
        _count: { _all: true },
      }),
      this.prisma.sendingSession.findMany({
        where: { orgId, status: { in: ["PENDING", "PROCESSING"] } },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);

    return {
      preparation: Object.fromEntries(preparationCounts.map((c) => [c.preparationStatus, c._count._all])),
      sending: Object.fromEntries(sendingCounts.map((c) => [c.status, c._count._all])),
      activeSessions,
    };
  }
}
