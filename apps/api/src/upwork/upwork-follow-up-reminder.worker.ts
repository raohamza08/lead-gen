import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { NotificationCategory, UpworkProposalStatus, UpworkProposalType } from "@prisma/client";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";
import { PrismaService } from "../common/prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";

/** "After every 2 days" (Part: Upwork follow-up reminders, 2026-09-30,
 *  explicit user request) -- both the minimum age before the first
 *  reminder (measured from `acceptedAt`) and the minimum gap between
 *  repeat reminders (measured from `lastFollowUpNotifiedAt`) for the same
 *  still-ACCEPTED proposal. */
export const UPWORK_FOLLOW_UP_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Consumes UpworkFollowUpReminderQueue's repeatable tick. Finds every
 * INVITE proposal that's sat at ACCEPTED for at least 2 days with no
 * further status change and has admin-picked recipients on file
 * (`notifyUserIds`), and nudges them to follow up -- repeating every 2 days
 * for as long as the status stays ACCEPTED and unattended. Moving the
 * status to anything else (IN_DISCUSSION, WON, LOST, ...) is what actually
 * stops the reminders; there's no separate snooze/dismiss for the
 * underlying condition, only for the notification itself.
 */
@Injectable()
export class UpworkFollowUpReminderWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UpworkFollowUpReminderWorker.name);
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(QUEUE_NAMES.UPWORK_FOLLOW_UP_REMINDER, () => this.tick(), {
      connection: getRedisConnection(),
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`upwork follow-up reminder tick failed: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  async tick() {
    const now = new Date();
    const dueBefore = new Date(now.getTime() - UPWORK_FOLLOW_UP_WINDOW_MS);

    const due = await this.prisma.upworkProposal.findMany({
      where: {
        type: UpworkProposalType.INVITE,
        status: UpworkProposalStatus.ACCEPTED,
        acceptedAt: { not: null, lte: dueBefore },
        notifyUserIds: { isEmpty: false },
        OR: [{ lastFollowUpNotifiedAt: null }, { lastFollowUpNotifiedAt: { lte: dueBefore } }],
      },
      select: { id: true, orgId: true, profileName: true, clientName: true, jobLink: true, notifyUserIds: true, acceptedAt: true },
    });

    for (const proposal of due) {
      const daysWaiting = Math.floor((now.getTime() - proposal.acceptedAt!.getTime()) / (24 * 60 * 60 * 1000));
      try {
        await this.notifications.notify(proposal.orgId, {
          category: NotificationCategory.UPWORK,
          type: "UPWORK_INVITE_FOLLOW_UP",
          title: "Follow up on this Upwork invite",
          message: `${proposal.clientName ?? "This client"}'s invite (${proposal.profileName}) was accepted ${daysWaiting} day(s) ago with no status update — we're missing a follow-up with them.`,
          actionUrl: "/upwork/invite",
          severity: "WARNING",
          entityType: "upworkProposal",
          entityId: proposal.id,
          recipientUserIds: proposal.notifyUserIds,
        });
        await this.prisma.upworkProposal.update({ where: { id: proposal.id }, data: { lastFollowUpNotifiedAt: now } });
      } catch (err) {
        this.logger.error(`Failed to send follow-up reminder for proposal ${proposal.id}: ${(err as Error).message}`);
      }
    }
  }
}
