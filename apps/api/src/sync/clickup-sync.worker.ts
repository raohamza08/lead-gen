import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Job, Worker } from "bullmq";
import { PrismaService } from "../common/prisma/prisma.service";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";
import { ClickupClient } from "./clickup.client";

const CLICKUP_STATUS_MAP: Record<string, string> = {
  NEW_LEAD: "New Lead",
  UNDER_REVIEW: "Under Review",
  READY_FOR_OUTREACH: "Ready for Outreach",
  EMAIL_1_SENT: "Email 1 Sent (Problem Trigger)",
  WAITING_EMAIL_2: "Waiting for Email 2",
  EMAIL_2_SENT: "Email 2 Sent (Industry Insight)",
  WAITING_EMAIL_3: "Waiting for Email 3",
  EMAIL_3_SENT: "Email 3 Sent (Proof)",
  WAITING_EMAIL_4: "Waiting for Email 4",
  EMAIL_4_SENT: "Email 4 Sent (Soft Offer)",
  WAITING_EMAIL_5: "Waiting for Email 5",
  EMAIL_5_SENT: "Email 5 Sent (Breakup)",
  LINKEDIN_OUTREACH: "LinkedIn Outreach",
  REPLIED: "Replied",
  MEETING_BOOKED: "Meeting Booked",
  PROPOSAL_SENT: "Proposal Sent",
  WON: "Won",
  LOST: "Lost",
};

/**
 * Creates/updates ClickUp task cards (Part C5). Idempotent by design: task
 * creation upserts on lead_id via the ClickupSync table, and status updates are
 * safe to replay (ClickUp can deliver duplicate webhooks/jobs).
 */
@Injectable()
export class ClickupSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClickupSyncWorker.name);
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly clickup: ClickupClient,
  ) {}

  onModuleInit() {
    this.worker = new Worker(
      QUEUE_NAMES.CLICKUP_SYNC,
      (job) => this.handle(job),
      { connection: getRedisConnection(), concurrency: 5 },
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async handle(job: Job<{ leadId: string; stage?: string }>) {
    if (job.name === "create-task") return this.createTask(job.data.leadId);
    if (job.name === "update-status") return this.updateStatus(job.data.leadId, job.data.stage!);
  }

  private async createTask(leadId: string) {
    const existing = await this.prisma.clickupSync.findUnique({ where: { leadId } });
    if (existing) return; // already created — avoid duplicate cards on retry

    const lead = await this.prisma.lead.findUniqueOrThrow({ where: { id: leadId }, include: { filter: true, score: true } });
    const listId = lead.filter?.clickupListId ?? this.config.get<string>("CLICKUP_DEFAULT_LIST_ID");

    let clickupTaskId = `unsynced-${leadId}`;
    if (this.clickup.isConfigured() && listId) {
      const task = await this.clickup.createTask(listId, {
        companyName: lead.companyName,
        website: lead.website,
        contactName: lead.contactName,
        jobTitle: lead.jobTitle,
        email: lead.email,
        phone: lead.phone,
        leadScore: lead.score?.leadScore,
        fitReason: lead.score?.fitReason,
      });
      clickupTaskId = task.id;
      this.logger.log(`Created ClickUp task ${clickupTaskId} for lead ${leadId}`);
    } else {
      this.logger.warn(`ClickUp not configured (token/list) — recording stub sync only for lead ${leadId}`);
    }

    await this.prisma.clickupSync.create({ data: { leadId, clickupTaskId } });
  }

  private async updateStatus(leadId: string, stage: string) {
    const sync = await this.prisma.clickupSync.findUnique({ where: { leadId } });
    if (!sync) {
      this.logger.warn(`No ClickUp task recorded for lead ${leadId} yet — skipping status update`);
      return;
    }
    const status = CLICKUP_STATUS_MAP[stage] ?? stage;

    if (this.clickup.isConfigured() && !sync.clickupTaskId.startsWith("unsynced-")) {
      await this.clickup.updateTaskStatus(sync.clickupTaskId, status);
      this.logger.log(`Set ClickUp task ${sync.clickupTaskId} status -> "${status}"`);
    } else {
      this.logger.warn(`ClickUp not configured — skipping real status update for lead ${leadId} -> "${status}"`);
    }
    await this.prisma.clickupSync.update({ where: { leadId }, data: { lastSyncedAt: new Date() } });
  }
}
