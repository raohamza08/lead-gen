import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Job, Worker } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "./redis-connection";
import { RealtimeGateway } from "../../realtime/realtime.gateway";
import { NotificationsService } from "../../notifications/notifications.service";
import type { AgentDispatchJob } from "./agent-dispatch.queue";

const DISPATCH_PATH: Record<AgentDispatchJob["kind"], string> = {
  enrich: "/lead-gen/enrich",
  email_draft: "/personalization/draft",
  linkedin_draft: "/linkedin/draft",
  extraction_run: "/lead-gen/runs",
};

function dispatchBody(data: AgentDispatchJob): Record<string, unknown> {
  switch (data.kind) {
    case "enrich":
      return { leadId: data.leadId, orgId: data.orgId };
    case "email_draft":
      return {
        leadId: data.leadId,
        orgId: data.orgId,
        step: data.step,
        orgContext: data.orgContext,
        caseStudy: data.caseStudy,
      };
    case "linkedin_draft":
      return { leadId: data.leadId, orgId: data.orgId };
    case "extraction_run":
      return { runId: data.runId, filter: data.filter, searchBrief: data.searchBrief };
  }
}

function leadIdOf(data: AgentDispatchJob): string | undefined {
  return "leadId" in data ? data.leadId : undefined;
}

/**
 * Consumes the agent-dispatch queue (Part: autonomous system). Every kind of
 * job here is a fire-and-forget POST to the Python AI workers — the actual
 * research/drafting/scoring happens over there and reports back via its own
 * internal-token-guarded endpoints (POST /leads, PATCH /leads/:id/enrichment,
 * etc.), same as before. What changes is that a network blip or a workers
 * restart now retries automatically instead of silently stranding the lead.
 */
@Injectable()
export class AgentDispatchWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentDispatchWorker.name);
  private worker?: Worker<AgentDispatchJob>;

  constructor(
    private readonly config: ConfigService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.worker = new Worker<AgentDispatchJob>(
      QUEUE_NAMES.AGENT_DISPATCH,
      (job) => this.handle(job),
      { connection: getRedisConnection(), concurrency: 5 },
    );
    this.worker.on("failed", (job, err) => {
      if (job) void this.onFailed(job, err);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async handle(job: Job<AgentDispatchJob>) {
    const data = job.data;
    const leadId = leadIdOf(data);
    if (leadId) {
      this.realtime.emitToOrg(data.orgId, "agentDispatch.status", {
        leadId,
        kind: data.kind,
        status: job.attemptsMade > 0 ? "RETRYING" : "PROCESSING",
      });
    }

    const aiWorkersUrl = this.config.get<string>("AI_WORKERS_URL", "http://localhost:8000");
    const res = await fetch(`${aiWorkersUrl}${DISPATCH_PATH[data.kind]}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dispatchBody(data)),
    });
    if (!res.ok) {
      throw new Error(`AI workers responded ${res.status} for ${data.kind}`);
    }
  }

  /**
   * BullMQ's "failed" event fires after EVERY attempt, not only the last
   * one — `job.attemptsMade` vs the job's configured `attempts` is how a
   * transient retry (still swallowed here, quietly) is told apart from
   * genuinely exhausted retries, which is the one case a human needs to
   * hear about (Part 6/9: "notify administrators only if automatic
   * recovery fails").
   */
  private async onFailed(job: Job<AgentDispatchJob>, err: Error) {
    const data = job.data;
    const maxAttempts = job.opts.attempts ?? 1;
    this.logger.warn(
      `agent-dispatch job ${job.id} (${data.kind}) attempt ${job.attemptsMade}/${maxAttempts} failed: ${err.message}`,
    );
    if (job.attemptsMade < maxAttempts) return;

    const leadId = leadIdOf(data);
    await this.notifications.notify(data.orgId, {
      type: "AGENT_DISPATCH_FAILED",
      severity: "ERROR",
      message: `${data.kind} could not be dispatched after ${job.attemptsMade} attempts: ${err.message}`,
      leadId,
    });
    if (leadId) {
      this.realtime.emitToOrg(data.orgId, "agentDispatch.status", {
        leadId,
        kind: data.kind,
        status: "FAILED",
      });
    }
  }
}
