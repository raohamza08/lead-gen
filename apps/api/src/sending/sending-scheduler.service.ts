import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import { CronJob } from "cron";
import { SendingSchedule } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { UpsertSendingScheduleDto } from "./dto/upsert-sending-schedule.dto";
import { nextDailyFireAfter, oneTimeFireDate } from "./schedule-time";
import { SendingQueueService } from "./sending-queue.service";

function jobName(orgId: string): string {
  return `sending-schedule:${orgId}`;
}

/**
 * One dynamic CronJob per org with an enabled SendingSchedule (Part:
 * Preparation Pipeline / Sending Queue, 2026-09-01) — same
 * SchedulerRegistry + `cron` package + explicit timezone pattern as
 * NicheFiltersService (this codebase's proven cron+timezone mechanism;
 * BullMQ's own `tz` repeatable-job option is never used anywhere here).
 *
 * DAILY uses a real recurring cron expression (`cron`/luxon handle the
 * timezone/DST correctness). ONE_TIME uses a cron expression that matches
 * exactly one calendar date, then unregisters itself and flips the
 * schedule's `enabled` off the moment it fires — a one-time schedule really
 * does mean once, not "every year on this date."
 */
@Injectable()
export class SendingSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SendingSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly sendingQueue: SendingQueueService,
  ) {}

  async onModuleInit() {
    const schedules = await this.prisma.sendingSchedule.findMany({ where: { enabled: true } });
    for (const schedule of schedules) {
      this.registerJob(schedule);
    }
    this.logger.log(`Scheduled ${schedules.length} active sending schedule(s) on startup`);
  }

  async getForOrg(orgId: string): Promise<SendingSchedule | null> {
    return this.prisma.sendingSchedule.findUnique({ where: { orgId } });
  }

  async upsert(orgId: string, dto: UpsertSendingScheduleDto): Promise<SendingSchedule> {
    const schedule = await this.prisma.sendingSchedule.upsert({
      where: { orgId },
      create: { orgId, ...dto },
      update: dto,
    });
    this.unregisterJob(orgId);
    if (schedule.enabled) this.registerJob(schedule);
    return schedule;
  }

  /** Estimated next fire time, for display only (see schedule-time.ts) —
   *  null if disabled or the schedule's cron/timezone failed to register. */
  getNextFireDate(schedule: Pick<SendingSchedule, "orgId" | "enabled" | "frequency" | "sendTime" | "timezone" | "oneTimeDate">): Date | null {
    if (!schedule.enabled) return null;
    if (!this.schedulerRegistry.doesExist("cron", jobName(schedule.orgId))) return null;
    try {
      if (schedule.frequency === "ONE_TIME") {
        return schedule.oneTimeDate ? oneTimeFireDate(schedule.oneTimeDate, schedule.sendTime, schedule.timezone) : null;
      }
      return nextDailyFireAfter(new Date(), schedule.sendTime, schedule.timezone);
    } catch {
      return null;
    }
  }

  private registerJob(schedule: SendingSchedule) {
    this.unregisterJob(schedule.orgId);
    const [hh, mm] = schedule.sendTime.split(":").map(Number);
    const isOneTime = schedule.frequency === "ONE_TIME";

    let cronExpr: string;
    if (isOneTime) {
      if (!schedule.oneTimeDate) {
        this.logger.warn(`ONE_TIME sending schedule for org ${schedule.orgId} has no oneTimeDate — not registering`);
        return;
      }
      const [, mo, d] = schedule.oneTimeDate.split("-").map(Number);
      cronExpr = `${mm} ${hh} ${d} ${mo} *`;
    } else {
      cronExpr = `${mm} ${hh} * * *`;
    }

    let job: CronJob;
    try {
      job = new CronJob(
        cronExpr,
        () => {
          this.fire(schedule.orgId, isOneTime).catch((err) =>
            this.logger.error(`Scheduled sending fire for org ${schedule.orgId} failed: ${(err as Error).message}`),
          );
        },
        null,
        true,
        schedule.timezone,
      );
    } catch (err) {
      this.logger.error(
        `Invalid sendTime/timezone for org ${schedule.orgId} (${schedule.sendTime} / ${schedule.timezone}): ${(err as Error).message}`,
      );
      return;
    }
    this.schedulerRegistry.addCronJob(jobName(schedule.orgId), job);
  }

  private async fire(orgId: string, isOneTime: boolean) {
    if (isOneTime) {
      // Once, really — unregister and disable before doing the actual work,
      // so a slow fire() can't overlap a second tick of the same cron
      // pattern (it would only ever fire once in a given year regardless,
      // but this also makes the "already fired" state immediately visible
      // in Settings without waiting for the send batch to finish).
      this.unregisterJob(orgId);
      await this.prisma.sendingSchedule.update({ where: { orgId }, data: { lastTriggeredAt: new Date(), enabled: false } });
    } else {
      await this.prisma.sendingSchedule.update({ where: { orgId }, data: { lastTriggeredAt: new Date() } });
    }
    await this.sendingQueue.fire(orgId);
  }

  private unregisterJob(orgId: string) {
    const name = jobName(orgId);
    if (this.schedulerRegistry.doesExist("cron", name)) {
      this.schedulerRegistry.deleteCronJob(name);
    }
  }
}
