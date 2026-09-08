import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Worker } from "bullmq";
import { NotificationCategory } from "@prisma/client";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";
import { PrismaService } from "../common/prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";

/** Consecutive failed checks before alerting -- one blip (a deploy restart,
 *  a slow GC pause) must not page anyone; two in a row (Part: comprehensive
 *  operational alerting, 2026-09-08) is a real outage at this 1-minute
 *  cadence. */
const CONSECUTIVE_FAILURES_TO_ALERT = 2;

/**
 * Consumes AiWorkersHealthQueue's repeatable tick — the process-level "is
 * the AI worker fleet even up" check (Part: comprehensive operational
 * alerting, 2026-09-08), distinct from AgentExecutionSweepWorker, which
 * only ever sees individual lead-level agent failures and has no way to
 * tell "ai-workers crashed" apart from "this one lead's draft failed."
 * In-memory consecutive-failure counter, not persisted -- a restart of this
 * worker resetting the count is an acceptable trade for not needing a DB
 * round trip on a 1-minute liveness ping.
 */
@Injectable()
export class AiWorkersHealthWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiWorkersHealthWorker.name);
  private worker?: Worker;
  private consecutiveFailures = 0;
  private alertSent = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(QUEUE_NAMES.AI_WORKERS_HEALTH, () => this.tick(), {
      connection: getRedisConnection(),
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`ai-workers health tick failed: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async tick() {
    const url = this.config.get<string>("AI_WORKERS_URL", "http://localhost:8000");
    const healthy = await this.checkHealth(url);

    if (healthy) {
      if (this.alertSent) {
        this.logger.warn("ai-workers back online after an outage");
        await this.notifyAllOrgs(
          "AI workers back online",
          `ai-workers (${url}) is responding again after ${this.consecutiveFailures} failed check(s).`,
          "resolved",
        );
        this.alertSent = false;
      }
      this.consecutiveFailures = 0;
      return;
    }

    this.consecutiveFailures++;
    if (this.consecutiveFailures >= CONSECUTIVE_FAILURES_TO_ALERT && !this.alertSent) {
      this.logger.error(`ai-workers unreachable at ${url} after ${this.consecutiveFailures} consecutive check(s)`);
      await this.notifyAllOrgs(
        "AI workers unreachable",
        `ai-workers (${url}) has failed ${this.consecutiveFailures} consecutive health checks — lead drafting/enrichment ` +
          `is likely stalled. Check the outly-ai-workers service on the server.`,
      );
      this.alertSent = true;
    }
  }

  private async checkHealth(url: string): Promise<boolean> {
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(10_000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** No per-org concept of "who owns ai-workers" -- it's one shared process
   *  for the whole deployment, so every org gets the alert rather than
   *  guessing one. At today's single-tenant scale this is just the one org;
   *  written as a loop so it stays correct if that ever changes. */
  private async notifyAllOrgs(title: string, message: string, tone: "alert" | "resolved" = "alert") {
    const orgs = await this.prisma.organization.findMany({ select: { id: true } });
    for (const org of orgs) {
      await this.notifications.notify(org.id, {
        category: NotificationCategory.SYSTEM,
        type: "AI_WORKERS_HEALTH",
        severity: tone === "resolved" ? "WARNING" : "ERROR",
        forceEmail: tone === "resolved",
        emailTone: tone,
        title,
        message,
        entityType: "system",
        actionUrl: "/admin/system-logs",
      });
    }
  }
}
